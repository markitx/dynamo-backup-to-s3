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

// Class/Inheritance can be done differently in ES6 but then
// we'd have to render it unusable for older engines (<4.0.0)
util.inherits(DynamoRestore, events.EventEmitter);

DynamoRestore.prototype.run = function(finishCallback) {
	this.debug('DynamoRestore.prototype.run()', this.options);
    this._validateS3Backup(this.options);
    this._createDatabase(this.options);
	this._streamBackup();
	this.on('finish', finishCallback);
};

DynamoRestore.prototype._validateS3Backup = function(options) {
	// Check S3 URI
	var url = URL.parse(options.source);
	if (!url || url.protocol !== 's3:') 
		this.emit('error', 'Please provide an s3 URI as file source (ie s3://mybucketname/folder/mydynamotable.json)');
	if (!url.pathname || !url.hostname || url.search || url.hash || url.auth) 
		this.emit('error', 'Please provide a simple s3 URI as file source (ie s3://mybucketname/folder/mydynamotable.json)');
	if (url.pathname.substr(-5).toLowerCase() !== '.json') 
		this.emit('error', 'Please provide a *.json file as source restoring backup.');
	if (!options.destination) 
		this.emit('Please provide a table name to restore to.');
	// Break up into individual components
	options.s3bucket = url.hostname;
	options.s3path = url.pathname.substr(1);
	options.s3filename = url.pathname.split('.').pop();
}

DynamoRestore.prototype._createDatabase = function(options) {
	this.debug('DynamoRestore.prototype._createDatabase()');
	var dynamo = new AWS.DynamoDB();
	if (!options.table) 
		this.emit('error', 'Please provide a Dynamo DB table name to restore to.');
	// Check if database exists etc
	// TODO:
	/*dynamo.listTables({}, function(error, data) {
		console.log(data);
	});*/
};

DynamoRestore.prototype._streamBackup = function() {
	this.debug('DynamoRestore.prototype._streamBackup()');
	var s3 = new AWS.S3();
	var params = { Bucket: this.options.s3bucket, Key: this.options.s3path };
	// First determine if file exists in s3
	s3.headObject(params, (function (error, meta) {
		if (error) {
			if (error.code === 'NotFound') this.emit('error', '404 Not Found. Could not find the file in s3.')
			else this.emit('error', util.format('Error downloading file from s3: %s', error));
			return;
		}
		// Then stream it line by line (each contains a db record)
		this.streamMeta = meta;
		this.emit('start-download', meta);
		var bufferedStream = this._bufferInput(s3.getObject(params).createReadStream());
		readline
			.createInterface({ input: bufferedStream })
			.on('line', this._processLine.bind(this))
			.on('close', (function() {
				this.emit('finish-download');
				this._finishBatches();
			}).bind(this));
	}).bind(this));
};

// Writing to Dynamo is usually slower than reading from S3,
// and we want to avoid clogging up memory or writing to disk.
// One way around this is to slow down the timing of S3 reads so that 
// it keeps checking the size of a buffer called 'batches',
// which incidentally contains a list of batches ready for DynamoDB to process.
DynamoRestore.prototype._bufferInput = function(stream) {
	this.debug('DynamoRestore.prototype._bufferInput()');
	var batches = this.batches = this.batches || [];
	var meta = this.streamMeta;
	var bufferSize = this.options.concurrency;

	stream.on('readable', function() {
		if (batches.length > bufferSize) {
			stream.pause();
		} else {
			stream.resume();
		}
	}).on('data', function(data) {
		// Keep tabs on how much data is remaining
		meta.ContentLength -= data.length;
	});

	return stream;
}

DynamoRestore.prototype._processLine = function(line) {
	this.requests = this.requests || [];
	this.requestItems = this.requestItems || [];
	this.requestItems.push({
		PutRequest: { Item: JSON.parse(line) }
	});
	// Create batches of 25 records each
	if (this.requestItems.length === DYNAMO_CHUNK_SIZE) {
		this.batches.push({
			id: this._uuid(),
			items: this.requestItems.splice(0, DYNAMO_CHUNK_SIZE),
			attempts: 0
		});
	}
	// Send batches if we dont already exceed concurrency (ie max requests)
	if (this.batches.length && this.requests.length < this.options.concurrency) {
		this._sendBatch();
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
		this.emit('finish-batch', this.requests.length);
	}).bind(this)));

	// Notify
	this.emit('send-batch', this.batches.length, this.streamMeta);
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
