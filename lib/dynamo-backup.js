
var _ = require('underscore');
var AWS = require('aws-sdk');
var events = require('events');
var moment = require('moment');
var path = require('path');
var async = require('async');
var util = require('util');

var Uploader = require('s3-streaming-upload').Uploader;

var ReadableStream = require('./readable-stream');

function DynamoBackup(options) {
    options = options || {};
    this.excludedTables = options.excludedTables || [];
    this.includedTables = options.includedTables;
    this.readPercentage = options.readPercentage || .25;
    this.backupPath = options.backupPath;
    this.bucket = options.bucket;
    this.stopOnFailure = options.stopOnFailure || false;
    this.awsAccessKey = options.awsAccessKey || process.env.AWS_ACCESS_KEY_ID;
    this.awsSecretKey = options.awsSecretKey || process.env.AWS_SECRET_ACCESS_KEY;
    this.awsRegion = options.awsRegion || process.env.AWS_DEFAULT_REGION || 'us-east-1';
    
    AWS.config.update({
        accessKeyId: this.awsAccessKey,
        secretAccessKey: this.secretAccessKey,
        region: this.awsRegion
    });
}

util.inherits(DynamoBackup, events.EventEmitter);

DynamoBackup.prototype.listTables = function (callback) {
    var self = this;
    self._fetchTables(null, [], callback);
}

DynamoBackup.prototype.backupTable = function (tableName, backupPath, callback) {
    var self = this;
    var stream = new ReadableStream();

    if (callback === undefined) {
        callback = backupPath;
        backupPath = self._getBackupPath();
    }

    var uploader = new Uploader({
        accessKey:  self.awsAccessKey,
        secretKey:  self.awsSecretKey,
        region:     self.awsRegion,
        bucket:     self.bucket,
        objectName: path.join(backupPath, tableName + '.json'),
        stream:     stream
    });

    uploader.on('failed', function(err) {
        self.emit('error', {
            table: tableName,
            err: err
        });
        return callback(err);
    });

    uploader.on('completed', function(err, res) {
        return callback(err);
    });

    self._copyTable(
        tableName,
        function(items) {
            items.forEach(function(item) {
                _.each(item, function (value, key) {
                    if (value && value.B) {
                        value.B = new Buffer(value.B).toString('base64');
                    }
                });
                stream.append(JSON.stringify(item));
                stream.append('\n');
            });
        },
        function(err) {
            stream.end();
            if(err) {
                self.emit('error', {
                    table: tableName,
                    err: err
                });
            }
        }
    );
}

DynamoBackup.prototype.backupAllTables = function (callback) {
    var self = this;
    var backupPath = self._getBackupPath();

    self.listTables(function(err, tables) {
        if (err) {
            return callback(err);
        }
        var includedTables = self.includedTables || tables;
        tables = _.difference(tables, self.excludedTables);
        tables = _.intersection(tables, includedTables);

        async.each(tables,
            function(tableName, done) {
                var startTime = moment();
                self.emit('start-backup', tableName);
                self.backupTable(tableName, backupPath, function(err) {
                    if (err) {
                        self.emit('error', {
                            tableName: tableName,
                            error: err
                        });
                        if (self.stopOnFailure) {
                            return done(err);
                        }
                    }
                    self.emit('end-backup', tableName);
                    done();
                })
            },
            callback
        );
    });
}

DynamoBackup.prototype._getBackupPath = function() {
    var self = this;
    var now = moment();
    return self.backupPath || ('DynamoDB-backup-' + now.format('YYYY-MM-DD-HH-mm-ss'));
}

DynamoBackup.prototype._copyTable = function (tableName, itemsReceived, callback) {
    var self = this;
    var ddb = new AWS.DynamoDB();
    ddb.describeTable({ TableName: tableName }, function(err, data) {
        if (err) {
            return callback(err);
        }

        var readPercentage = self.readPercentage;
        var limit = Math.max((data.Table.ProvisionedThroughput.ReadCapacityUnits * readPercentage)|0, 1);

        self._streamItems(tableName, null, limit, itemsReceived, callback);
    });
}

DynamoBackup.prototype._streamItems = function fetchItems(tableName, startKey, limit, itemsReceived, callback) {
    var self = this;
    var ddb = new AWS.DynamoDB();
    var params = {
        Limit: limit,
        ReturnConsumedCapacity: 'NONE',
        TableName: tableName
    };
    if (startKey) {
        params.ExclusiveStartKey = startKey;
    }
    ddb.scan(params, function(err, data) {
        if (err) {
            return callback(err);
        }

        if(data.Items.length > 0) {
            itemsReceived(data.Items);
        }

        if (!data.LastEvaluatedKey || _.keys(data.LastEvaluatedKey).length === 0) {
            return callback();
        }
        self._streamItems(tableName, data.LastEvaluatedKey, limit, itemsReceived, callback);
    });
}

DynamoBackup.prototype._fetchTables = function(lastTable, tables, callback) {
    var self = this;
    var ddb = new AWS.DynamoDB();
    var params = {};
    if (lastTable) {
        params.ExclusiveStartTableName = lastTable;
    }
    ddb.listTables(params, function(err, data) {
        if (err) {
            return callback(err, null);
        }
        tables = tables.concat(data.TableNames);
        if (data.LastEvaluatedTableName) {
            self._fetchTables(data.LastEvaluatedTableName, tables, callback);
        } else {
            callback(null, tables);
        }
    });
};

module.exports = DynamoBackup;
