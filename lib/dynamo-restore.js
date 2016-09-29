var fs = require('fs');
var util = require('util');
var AWS = require('aws-sdk');
var events = require('events');
var readline = require('readline');
var child_process = require('child_process');
var DYNAMO_CHUNK_SIZE = 25;

// s3://dynamo-backup-sds-test/generated.json

function DynamoRestore(options) {
	options = options || {};
    options.awsAccessKey = options.awsAccessKey || process.env.AWS_ACCESS_KEY_ID;
    options.awsSecretKey = options.awsSecretKey || process.env.AWS_SECRET_ACCESS_KEY;
    options.awsRegion = options.awsRegion || process.env.AWS_DEFAULT_REGION || 'ap-southeast-2';

    AWS.config.update({
        accessKeyId: options.awsAccessKey,
        secretAccessKey: options.secretAccessKey,
        region: options.awsRegion
    });

    this.options = options;
};

util.inherits(DynamoRestore, events.EventEmitter);

DynamoRestore.prototype.run = function(finishCallback) {
	this.log('DynamoRestore.prototype.run()');
	var filepath = this._getBackup();
	this.on('backup-downloaded', this._createChunks.bind(this, filepath));
	this.on('chunks-ready', this._processChunks.bind(this));
	this.on('finish', finishCallback);
};

DynamoRestore.prototype._getBackup = function() {
	this.log('DynamoRestore.prototype._getBackup()');
	setTimeout(this.emit.bind(this, 'backup-downloaded', 'filepath'), 1000);
};

DynamoRestore.prototype._createChunks = function(filepath) {
	this.log('DynamoRestore.prototype._createChunks()');
	this.emit('chunks-ready');
};

DynamoRestore.prototype._processChunks = function() {
	this.log('DynamoRestore.prototype._processChunks()');
	this.emit('finish');
};

DynamoRestore.prototype.log = function() {
	if (this.options.debug) {
		console.log.apply(console, arguments);
	}
};

module.exports = DynamoRestore;
