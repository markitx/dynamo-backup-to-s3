/*
 * lib/dynamo-restore.js
 *
 * By Steven de Salas
 *
 * AWS Restore to DynamoDB. Streams an S3 backup to a new DynamoDB table.
 *
 */
var URL = require('url');
var util = require('util');
var AWS = require('aws-sdk');
var events = require('events');
var readline = require('readline');
var DYNAMO_CHUNK_SIZE = 25;

function DynamoRestore(options) {
	options = options || {};
	options.concurrency = options.concurrency || 25;
	options.readcapacity = options.readcapacity || 5;
	options.writecapacity = options.writecapacity || 5;
	options.stopOnFailure = options.stopOnFailure || false;
    options.awsKey = options.awsKey || process.env.AWS_ACCESS_KEY_ID;
    options.awsSecret = options.awsSecret || process.env.AWS_SECRET_ACCESS_KEY;
    options.awsRegion = options.awsRegion || process.env.AWS_DEFAULT_REGION;

    AWS.config.update({
        accessKeyId: options.awsKey,
        secretAccessKey: options.awsSecret,
        region: options.awsRegion
    });
	this.error = false
    this.options = options;
};

// Stick to prototypal inheritance. While this can be done differently
// in ES6 we'd be making package unusable for older engines (0.10.x->0.12.x)
util.inherits(DynamoRestore, events.EventEmitter);

DynamoRestore.prototype.run = function(finishCallback) {
    this._validateS3Backup(this.options);
	if (this.options.restoreSchema)
		this._validateS3SchemaBackup(this.options);
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
	this.on('error', (function(err){
		this.error = true
	}).bind(this))
};

DynamoRestore.prototype._validateS3Backup = function(options) {
	// Check S3 URI
	var url = URL.parse(options.source);
	if (!url || url.protocol !== 's3:') {
		this.emit('error', 'Please provide an s3 URI as file source (ie s3://mybucketname/folder/mydynamotable.json)');
		return
	}
	if (!url.pathname || !url.hostname || url.search || url.hash || url.auth) {
		this.emit('error', 'Please provide a simple s3 URI as file source (ie s3://mybucketname/folder/mydynamotable.json)');
		return
	}
	if (url.pathname.substr(-5).toLowerCase() !== '.json') {
		this.emit('error', 'Please provide a *.json file as source restoring backup.');
		return
	}
	// Break up into individual components
	options.s3bucket = url.hostname;
	options.s3path = url.pathname.substr(1);
	options.s3filename = url.pathname.split('.').pop();
};

DynamoRestore.prototype._validateS3SchemaBackup = function(options) {
	// Check S3 URI
	var url = URL.parse(options.restoreSchema);
	if (!url || url.protocol !== 's3:') {
		this.emit('error', 'Please provide an s3 URI as schema source (ie s3://mybucketname/folder/mydynamotable.schema.json)');
		return
	}
	if (!url.pathname || !url.hostname || url.search || url.hash || url.auth) {
		this.emit('error', 'Please provide a simple s3 URI as schema file source (ie s3://mybucketname/folder/mydynamotable.schema.json)');
		return
	}
	if (url.pathname.substr(-5).toLowerCase() !== '.json') {
		this.emit('error', 'Please provide a *.json file as schema source restoring backup.');
		return
	}
	// Break up into individual components
	options.schemaS3bucket = url.hostname;
	options.schemaS3path = url.pathname.substr(1);
};

DynamoRestore.prototype._validateTable = function(options) {
	var dynamodb = new AWS.DynamoDB();
	if (!options.table) {
		this.emit('error', 'Please provide a Dynamo DB table name to restore to.');
		return
	}
	dynamodb.listTables({}, this._checkTableExists.bind(this));
};

DynamoRestore.prototype._checkTableExists = function(error, data) {
	if (error || !data || !data.TableNames){
		this.emit('error', 'Fatal Error. Could not connect to AWS DynamoDB engine. Please check your credentials.');
		return
	}
	if (data.TableNames.indexOf(this.options.table) > -1){
		this.emit('error', 'Fatal Error. The destination table already exists! Exiting process..')
		return
	}
	if (this.options.restoreSchema) {
		this._restoreTable();
	} else if (this.options.partitionkey && this.options.partitionkeytype) {
		// Once we know the partition key and data type the rest is a breeze.
		this._reproduceTable();
	} else if (!this.error) {
		// No partition key info? Loop until we have it
		setTimeout(this._checkTableExists.bind(this, error, data), 200);
	}
};

DynamoRestore.prototype._startDownload = function() {
	var s3 = new AWS.S3();
	var params = { Bucket: this.options.s3bucket, Key: this.options.s3path };
	// First determine if file exists in s3
	s3.headObject(params, (function (error, meta) {
		if (error) {
			if (error.code === 'NotFound') this.emit('error', util.format('Could not find file in s3. %s', this.options.source));
			else this.emit('error', util.format('Error downloading file from s3: %s', error));
			return;
		}
		// All good, start downloading
		this.emit('start-download', meta);
		this.readline = readline.createInterface({ input: s3.getObject(params).createReadStream().pause() })
			.on('line', this._processLine.bind(this))
			.on('close', (function() {
				this.emit('finish-download');
				this.batches.push({
					items: this.requestItems.splice(0, DYNAMO_CHUNK_SIZE),
					attempts: 0
				});
				this._finishBatches();
			}).bind(this));
		this.readline.meta = meta;
		this.readline.meta.RemainingLength = meta.ContentLength;
	}).bind(this));
};

DynamoRestore.prototype._processLine = function(line) {
	this.batches = this.batches || [];
	this.requests = this.requests || [];
	this.requestItems = this.requestItems || [];
	// First Line?
	if (!this.template) {
		// Use this to extract schema information
		this.readline.pause();
		this.template = JSON.parse(line);
		this._extractSchema(this.template);
	}
	// Keep tabs on how much data is being consumed
	this.readline.meta.RemainingLength -= line.length + 1;
	// Create batches of 25 records each
	this.requestItems.push({ PutRequest: { Item: JSON.parse(line) } });
	if (this.requestItems.length === DYNAMO_CHUNK_SIZE) {
		this.batches.push({
			items: this.requestItems.splice(0, DYNAMO_CHUNK_SIZE),
			attempts: 0
		});
	}
	// Writing to Dynamo is usually slower than reading from S3,
	// and we want to avoid clogging up memory or writing to disk.
	// The list of batches waiting for DynamoDB to process would
	// quickly get out of hand here, so an easy way around this is to
	// stop reading from S3 when the number of requests in flight goes past a
	// certain size, and then continue reading when the number is reduced.
	if (this.requests.length >= this.options.concurrency) {
		//Too many requests! Pausing download..
		this.readline.pause();
	}
	// Send the next batch if we are not exceeding concurrency (ie max requests)
	else if (this.batches.length) {
		this._sendBatch();
	}
};

DynamoRestore.prototype._extractSchema = function(template) {
	var partitionkey = this.options.partitionkey;
	if (partitionkey) {
		// Check it actually exists
		if (!template[partitionkey]) {
			this.emit('error', util.format('Fatal Error. The --partitionkey "%s" you provided is not a valid column.', partitionkey));
			return
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
			return
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
			return
		}
		this.options.sortkeytype = Object.keys(template[sortkey]).pop();
	}
};

DynamoRestore.prototype._reproduceTable = function() {
	options = this.options;
	if (!options.table || !options.partitionkey) {
		this.emit('error', 'Fatal Error. Could not create dynamo table. Not enough information provided.');
		return
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
			WriteCapacityUnits: options.concurrency * 2 // Need this high for pumping data, but will reduce it later.
		}
	};
	if (options.sortkey) {
		params.AttributeDefinitions.push({ AttributeName: options.sortkey, AttributeType: options.sortkeytype});
		params.KeySchema.push({ AttributeName: options.sortkey, KeyType: 'RANGE' });
	}

	return this._createTable(params)
}

DynamoRestore.prototype._restoreTable = function() {
	var s3 = new AWS.S3();
	var params = { Bucket: this.options.schemaS3bucket, Key: this.options.schemaS3path};
	s3.getObject(params, (function(err, data){
		if (err) {
			this.emit('error', 'Restore bucket Fatal Error. \n' + err.toString())
			return
		}
		var params = JSON.parse(data.Body.toString())
		if (this.options.table) {
			params.TableName = this.options.table
		}

		this._createTable(params)
	}).bind(this))
}

DynamoRestore.prototype._createTable = function(params) {
	var dynamodb = new AWS.DynamoDB();
	dynamodb.createTable(params, (function(error, data) {
		if (error || !data) {
			this.emit('error', 'Fatal Error. Failed to create new table. ' + error);
			return
		}
		data = data.TableDescription;
		dynamodb.describeTable({ TableName: data.TableName }, this._checkTableReady.bind(this));
	}).bind(this));
};

DynamoRestore.prototype._checkTableReady = function(error, data) {
	var dynamodb = new AWS.DynamoDB();
	if (error || !data || !data.Table) {
		this.emit('error', 'Error creating table ' + this.options.table);
		return
	}
	if (data
		&& data.Table
		&& data.Table.TableStatus === 'ACTIVE') {
			// All ready, now we can start inserting records
			this.readline.resume();
	} else {
		setTimeout(dynamodb.describeTable.bind(dynamodb, { TableName: data.Table.TableName }, this._checkTableReady.bind(this)), 200);
	}
};

DynamoRestore.prototype._sendBatch = function() {
	// Prepare
	var params = { RequestItems: {} },
		dynamo = new AWS.DynamoDB(),
		batch = this.batches.shift();
	params.RequestItems[this.options.table] = batch.items;

	// Send
	this.requests.push(dynamo.batchWriteItem(params, (function(error, data) {
		this.requests.shift();
		if (error) {
			// Problem? Check the number of attempts
			if (batch.attempts > 2) {
				if (options.stopOnFailure) {
					this.emit('error', 'Fatal Error. Failed to upload same batch three times. Ending process. \n' + JSON.stringify(batch));
					return
				} else {
					this.emit('warning', 'Failed to upload same batch three times, removing from queue.. \n' + JSON.stringify(batch));
				}
			} else {
				this.emit('warning', 'Error processing batch, putting back in the queue.');
				batch.attempts++;
				this.batches.push(batch);
			}
		}
		// Continue downloading data...
		if (this.requests.length < this.options.concurrency * 0.8) {
			this.readline.resume();
		}
		this.emit('finish-batch', this.requests.length);
	}).bind(this)));

	// Notify
	this.emit('send-batch', this.batches.length, this.requests.length, this.readline.meta);
};

DynamoRestore.prototype._finishBatches = function() {
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

module.exports = DynamoRestore;
