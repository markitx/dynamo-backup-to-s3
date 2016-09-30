/*
 * lib/dynamo-restore.js
 *
 * By Steven de Salas
 * 
 * AWS Restore to DynamoDB. Streams an S3 backup to a new DynamoDB table.
 *
 */
var fs = require('fs');
var URL = require('url');
var util = require('util');
var AWS = require('aws-sdk');
var Stream = require('stream');
var events = require('events');
var readline = require('readline');
var DYNAMO_CHUNK_SIZE = 25;

function DynamoRestore(options) {
	options = options || {};
	options.concurrency = options.concurrency || 25;
	options.readcapacity = options.readcapacity || 5;
	options.writecapacity = options.writecapacity || 5;
    options.awsKey = options.awsKey || process.env.AWS_ACCESS_KEY_ID;
    options.awsSecret = options.awsSecret || process.env.AWS_SECRET_ACCESS_KEY;
    options.awsRegion = options.awsRegion || process.env.AWS_DEFAULT_REGION || 'ap-southeast-2';

    AWS.config.update({
        accessKeyId: options.awsKey,
        secretAccessKey: options.awsSecret,
        region: options.awsRegion
    });

    this.options = options;
};

// Stick to classic inheritance. While this can be done differently 
// in ES6 we'd be making package unusable for older engines (0.10.x->0.12.x)
util.inherits(DynamoRestore, events.EventEmitter);

DynamoRestore.prototype.run = function(finishCallback) {
	this.debug('DynamoRestore.prototype.run()', this.options);
    this._validateS3Backup(this.options);
    this._validateTable(this.options);
	this._startDownload();
	this.on('finish', (function() {
		var dynamodb = new AWS.DynamoDB(),
			options = this.options;
		// Finish off by updating read/write capacity to end-state
		dynamodb.updateTable({
			TableName: options.table,
			ProvisionedThroughput: {
			    ReadCapacityUnits: options.readcapacity,
			    WriteCapacityUnits: options.writecapacity
			  }
		}, finishCallback);
	}).bind(this));
};

DynamoRestore.prototype._validateS3Backup = function(options) {
	// Check S3 URI
	var url = URL.parse(options.source);
	if (!url || url.protocol !== 's3:') {
		this.emit('error', 'Please provide an s3 URI as file source (ie s3://mybucketname/folder/mydynamotable.json)');
	}
	if (!url.pathname || !url.hostname || url.search || url.hash || url.auth) {
		this.emit('error', 'Please provide a simple s3 URI as file source (ie s3://mybucketname/folder/mydynamotable.json)');
	}
	if (url.pathname.substr(-5).toLowerCase() !== '.json') {
		this.emit('error', 'Please provide a *.json file as source restoring backup.');
	}
	// Break up into individual components
	options.s3bucket = url.hostname;
	options.s3path = url.pathname.substr(1);
	options.s3filename = url.pathname.split('.').pop();
};

DynamoRestore.prototype._validateTable = function(options) {
	this.debug('DynamoRestore.prototype._validateTable()');
	var dynamodb = new AWS.DynamoDB();
	if (!options.table) {
		this.emit('error', 'Please provide a Dynamo DB table name to restore to.');
	}
	dynamodb.listTables({}, this._checkTableExists.bind(this));
};

DynamoRestore.prototype._checkTableExists = function(error, data) {
	this.debug('DynamoRestore.prototype._checkTableExists()', data);
	if (error || !data || !data.TableNames){
		this.emit('error', 'Fatal Error. Could not connect to AWS DynamoDB engine. Please check your credentials.');
	}
	if (data.TableNames.indexOf(this.options.table) > -1){
		this.emit('error', 'Fatal Error. The destination table already exists! Exiting process..')
	}
	if (this.options.partitionkey && this.options.partitionkeytype) {
		// Once we know the partition key and data type the rest is a breeze.
		this._createTable();
	} else {
		// No partition key info? Loop until we have it
		setTimeout(this._checkTableExists.bind(this, error, data), 200);
	}
};

DynamoRestore.prototype._startDownload = function() {
	this.debug('DynamoRestore.prototype._startDownload()');
	var s3 = new AWS.S3();
	var params = { Bucket: this.options.s3bucket, Key: this.options.s3path };
	// First determine if file exists in s3
	s3.headObject(params, (function (error, meta) {
		if (error) {
			if (error.code === 'NotFound') this.emit('error', '404 Not Found. Could not find the file in s3.')
			else this.emit('error', util.format('Error downloading file from s3: %s', error));
			return;
		}
		// All good, start downloading 
		this.emit('start-download', meta);
		this.stream = readline.createInterface({ input: s3.getObject(params).createReadStream() })
			.on('line', this._processLine.bind(this))
			.on('close', (function() {
				this.emit('finish-download');
				this._finishBatches();
			}).bind(this));
		this.stream.meta = meta;
	}).bind(this));
};

var lines = 0;

DynamoRestore.prototype._processLine = function(line) {
	this.batches = this.batches || [];
	this.requests = this.requests || [];
	this.requestItems = this.requestItems || [];
	// First Line?
	if (!this.template) {
		// Use this to extract schema information
		this.stream.pause();
		this.template = JSON.parse(line);
		this._extractSchema(this.template);
	}
	// Create batches of 25 records each
	this.requestItems.push({ PutRequest: { Item: JSON.parse(line) } });
	if (this.requestItems.length === DYNAMO_CHUNK_SIZE) {
		this.batches.push({
			id: this._uuid(),
			items: this.requestItems.splice(0, DYNAMO_CHUNK_SIZE),
			attempts: 0
		});
	}
	// Keep tabs on how much data is being consumed
	this.stream.meta.ContentLength -= line.length + 1;
	this.debug('Line %d', ++lines);
	// Send the next if we are not exceeding concurrency (ie max requests)
	if (this.batches.length && this.requests.length < this.options.concurrency) {
		this._sendBatch();
	}
	// Writing to Dynamo is usually slower than reading from S3,
	// and we want to avoid clogging up memory or writing to disk.
	// The list of batches waiting for DynamoDB to process would
	// quickly get out of hand here, so an easy way around this is to 
	// stop reading from S3 when the list of batches goes past a
	// certain size, and then continue reading when next batch is finished.
	if (this.batches.length > this.options.concurrency) {
		this.stream.pause(); 
	}
};

DynamoRestore.prototype._extractSchema = function(template) {
	this.debug('DynamoRestore.prototype._extractSchema(template)', template);
	var partitionkey = this.options.partitionkey;
	if (partitionkey) {
		// Check it actually exists
		if (!template[partitionkey]) {
			this.emit('error', util.format('Fatal Error. The --partitionkey "%s" you provided is not a valid column.', partitionkey));
		}
	} else {
		// Or if unkonwn, find the most likely candidate
		var likelyCandidates = Object.keys(template).filter(function(column) {
			return column.toLowerCase().substr(-2) === 'id'
				||	column.toLowerCase().substr(-3) === 'key'
				||	column.toLowerCase().substr(-3) === 'ref';
		});
		if (likelyCandidates.length === 0) {
			this.emit('error', 'Fatal Error. Cannot determine --partitionkey from backup, please supply it manually.');
		} else {
			// Pick the shortest one 
			partitionkey = likelyCandidates.sort(function(a, b) { return b.length - a.length; }).pop();
		}
		this.options.partitionkey = partitionkey;
		this.options.sortkey = undefined;
	}
	// And find the type for each primary and secondary
	this.options.partitionkeytype = Object.keys(template[partitionkey]).pop();
	if (this.options.sortkey) {
		var sortkey = this.options.sortkey;
		if (!template[sortkey]) {
			this.emit('error', 'Fatal Error. The --sortkey you provided is not available for some records.')
		}
		this.options.sortkeytype = Object.keys(template[sortkey]).pop();
	}
};

DynamoRestore.prototype._createTable = function(callback) {
	this.debug('DynamoRestore.prototype._createTable()');
	var dynamodb = new AWS.DynamoDB(),
		options = this.options;
	if (!options.table || !options.partitionkey) {
		this.emit('error', 'Fatal Error. Could not create dynamo table. Not enough information provided.');
	}
	var params = {
		TableName: options.table,
		AttributeDefinitions: [{
			AttributeName: options.partitionkey,
			AttributeType: options.partitionkeytype
		}],
		KeySchema: [{
			AttributeName: options.partitionkey,
			KeyType: 'HASH'
		}],
		ProvisionedThroughput: { 
			ReadCapacityUnits: options.readcapacity, 
			WriteCapacityUnits: options.concurrency // Need this high for pumping data, but will reduce it later.
		}
	};
	if (options.sortkey) {
		params.AttributeDefinitions.push({ AttributeName: options.sortkey, AttributeType: options.sortkeytype});
		params.KeySchema.push({ AttributeName: options.sortkey, KeyType: 'RANGE' });
	}
	this.debug('dynamodb.createTable(params)', params);
	var request = dynamodb.createTable(params, (function(error, data) {
		if (error || !data) {
			this.emit('error', 'Fatal Error. Failed to create new table. ' + error);
		}
		data = data.TableDescription;
		this.debug('Created table "%s". Current status "%s".', data.TableName, data.TableStatus);
		dynamodb.describeTable({ TableName: data.TableName }, this._checkTableReady.bind(this));
	}).bind(this));
};

DynamoRestore.prototype._checkTableReady = function(error, data) {
	this.debug('DynamoRestore.prototype._checkTableReady()');
	var dynamodb = new AWS.DynamoDB();
	if (error || !data || !data.Table) {
		this.emit('error', 'Error creating table ' + this.options.table);
	}
	if (data 
		&& data.Table 
		&& data.Table.TableStatus === 'ACTIVE') {
			// All ready, now we can start inserting records
			this.debug('Table ready. Status: "%s"', data.Table.TableStatus);
			this.stream.resume();
	} else {
		this.debug('Table not ready for input. Status: "%s"', data.Table.TableStatus);
		setTimeout(dynamodb.describeTable.bind(dynamodb, { TableName: data.Table.TableName }, this._checkTableReady.bind(this)), 1000);
	}
};

DynamoRestore.prototype._sendBatch = function() {
	this.debug('DynamoRestore.prototype._sendBatch()');
	// Prepare
	var params = { RequestItems: {} },
		dynamo = new AWS.DynamoDB(),
		batch = this.batches.shift();
	params.RequestItems[this.options.table] = batch.items;

	// Send
	this.requests.push(dynamo.batchWriteItem(params, (function(error, data) {
		this.debug('DynamoRestore.prototype._sendBatch().finished()', batch.id);
		this.requests.shift();
		if (error) {
			// Problem? Check the number of attempts
			if (batch.attempts > 2) {
				this.emit('error', 'Fatal Error. Failed to upload same batch three times. Ending process. \n' + JSON.stringify(batch))
			} else {
				this.emit('warning', 'Error processing batch, putting back in the queue.');
				batch.attempts++;
				this.batches.push(batch);
			}
		} else {
			this.debug('Batch processed succesfully.');
		}
		// Continue consuming data
		this.stream.resume();
		this.emit('finish-batch', this.requests.length);
	}).bind(this)));

	// Notify
	this.emit('send-batch', this.batches.length, this.requests.length, this.stream.meta);
};

DynamoRestore.prototype._finishBatches = function() {
	this.debug('DynamoRestore.prototype._finishBatches()');
	if (!this.batches.length) {
		if (!this.requests.length) {
			// Finish only if there is nothing left to wait for.
			this.emit('finish');
			return;
		}
	} else {
		// Send remaining batches
		if (this.requests.length < this.options.concurrency) {
			this._sendBatch();
		}
	}
	// Repeat until finished
	setTimeout(this._finishBatches.bind(this), 200);
}

DynamoRestore.prototype._uuid = function () {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  }
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
    s4() + '-' + s4() + s4() + s4();
};

DynamoRestore.prototype.debug = function() {
	if (this.options.debug) {
		console.log.apply(console, arguments);
	}
};

module.exports = DynamoRestore;
