var _ = require('lodash');
var AWS = require('aws-sdk');
var events = require('events');
var moment = require('moment');
var dateRange = require('moment-range');
var path = require('path');
var async = require('async');
var util = require('util');

var Uploader = require('s3-streaming-upload').Uploader;

var ReadableStream = require('./readable-stream');

function DynamoBackup(options) {
    var params = {};
    options = options || {};
    this.excludedTables = options.excludedTables || [];
    this.includedTables = options.includedTables;
    this.readPercentage = options.readPercentage || .25;
    this.readCapacity = options.readCapacity || 0;
    this.parallel = options.parallel || 1;
    this.backupPath = options.backupPath;
    this.bucket = options.bucket;
    this.stopOnFailure = options.stopOnFailure || false;
    this.base64Binary = options.base64Binary || false;
    this.saveDataPipelineFormat = options.saveDataPipelineFormat || false;
    this.awsAccessKey = options.awsAccessKey;
    this.awsSecretKey = options.awsSecretKey;
    this.awsRegion = options.awsRegion;
    this.debug = Boolean(options.debug);

    if (this.awsRegion) {
        params.region = this.awsRegion;
    }
    if (this.awsAccessKey && this.awsSecretKey) {
        params.accessKeyId = this.awsAccessKey;
        params.secretAccessKey = this.awsSecretKey;
    }

    AWS.config.update(params);
}

util.inherits(DynamoBackup, events.EventEmitter);

DynamoBackup.prototype.listTables = function (callback) {
    var self = this;
    self._fetchTables(null, [], callback);
};

DynamoBackup.prototype.backupTable = function (tableName, backupPath, callback) {
    var self = this;
    var stream = new ReadableStream();

    if (callback === undefined) {
        callback = backupPath;
        backupPath = self._getBackupPath();
    }

   var params = {};
   if (self.awsRegion) {
       params.region = self.awsRegion;
   }
   if (self.awsAccessKey && self.awsSecretKey) {
        params.accessKey = self.awsAccessKey;
        params.secretKey = self.awsSecretKey;
    }

   params.bucket = self.bucket;
   params.objectName = path.join(backupPath, tableName + '.json');
   params.stream = stream;
   params.debug = self.debug;

   var upload = new Uploader(params);

    var startTime = moment.utc();
    self.emit('start-backup', tableName, startTime);
    upload.send(function (err) {
        if (err) {
            self.emit('error', {
                table: tableName,
                err: err
            });
        }
        var endTime = moment.utc();
        var backupDuration = new dateRange(startTime, endTime);
        self.emit('end-backup', tableName, backupDuration);
        return callback(err);
    });

    // writes each item to stream
    var itemsHandler = function (items) {
        items.forEach(function (item) {
            if (self.base64Binary) {
                _.each(item, function (value, key) {
                    if (value && value.B) {
                        value.B = new Buffer(value.B).toString('base64');
                    }
                });
            }

            if (self.saveDataPipelineFormat) {
                stream.append(self._formatForDataPipeline(item));
            } else {
                stream.append(JSON.stringify(item));
            }
            stream.append('\n');
        });
    };

    var endStream = function (err) {
        stream.end();
        if (err) {
            self.emit('error', {
                tableName: tableName,
                error: err
            });
        }
    };

    if (self.readCapacity === 0) {
        self._copyTable(tableName, null, self.parallel, itemsHandler, endStream);
    } else {
        self._updateTable(
            tableName,
            self.readCapacity,
            function (oldReadCapacity, oldWriteCapacity, newReadCapacity) {
                self._copyTable(tableName, newReadCapacity, self.parallel, itemsHandler, function(err) {
                    self._restoreTable(tableName, oldReadCapacity, oldWriteCapacity, function(err2) {
                        endStream(err || err2);
                    });
                });
            },
            endStream
        );
    }
};

DynamoBackup.prototype.backupAllTables = function (callback) {
    var self = this;
    var backupPath = self._getBackupPath();

    self.listTables(function (err, tables) {
        if (err) {
            return callback(err);
        }
        var includedTables = self.includedTables || tables;
        tables = _.difference(tables, self.excludedTables);
        tables = _.intersection(tables, includedTables);

        async.each(tables,
            function (tableName, done) {
                self.backupTable(tableName, backupPath, function (err) {
                    if (err) {
                        if (self.stopOnFailure) {
                            return done(err);
                        }
                    }
                    done();
                })
            },
            callback
            );
    });
};

DynamoBackup.prototype._getBackupPath = function () {
    var self = this;
    var now = moment.utc();
    return self.backupPath || ('DynamoDB-backup-' + now.format('YYYY-MM-DD-HH-mm-ss'));
};

// starts a _streamItems() loop, which calls itemsReceived each time, then callback when finished or failed
DynamoBackup.prototype._copyTable = function (tableName, readCapacity, parallelReads, itemsReceived, callback) {
    var self = this;
    var ddb = new AWS.DynamoDB();
    // DynamoDB is "eventually consistent". If we just called ddb.updateTable, then ddb.describeTable might return the
    // old values for readCapacity. To get around this, allow readCapacity to be passed as an argument

    var startStreams = function(readCapacity) {
        var readPercentage = self.readPercentage;
        var limit = Math.max((readCapacity * readPercentage) | 0, 1);
        console.log('Limiting reads to ' + limit * parallelReads + '/s (actual speed may be slower)')

        if (parallelReads > 1) {
            var asyncTracker = function(err, data) {;};
            async.map(
                _.range(parallelReads),
                function(i, cb) {
                    self._streamItems(tableName, null, limit, i, parallelReads, itemsReceived, cb);
                },
                callback
            );
        } else {
            self._streamItems(tableName, null, limit, null, null, itemsReceived, callback);
        }
    };

    if (readCapacity) {
        startStreams(readCapacity);
    } else {
        ddb.describeTable({ TableName: tableName }, function (err, data) {
            if (err) {
                return callback(err);
            }

            startStreams(data.Table.ProvisionedThroughput.ReadCapacityUnits);
        });
    }
};

// calls successCallback on success with (oldReadCapacity, oldWriteCapacity, newReadCapacity)
// on failure, tries to restoreTable, and calls errorCallback with error
DynamoBackup.prototype._updateTable = function (tableName, newReadCapacity, successCallback, errorCallback) {
    var self = this;
    var ddb = new AWS.DynamoDB();

    ddb.describeTable({ TableName: tableName }, function (err, data) {
        if (err) {
            return errorCallback(err);
        }

        var oldReadCapacity = data.Table.ProvisionedThroughput.ReadCapacityUnits,
            oldWriteCapacity = data.Table.ProvisionedThroughput.WriteCapacityUnits;

        if (newReadCapacity == oldReadCapacity) {
            return successCallback();
        }

        var params = {
            TableName: tableName,
            ProvisionedThroughput: {
                ReadCapacityUnits: newReadCapacity,
                WriteCapacityUnits: oldWriteCapacity
            }
        };

        var tryRestore = function(err) {
            self._restoreTable(tableName, oldReadCapacity, oldWriteCapacity, function(err2) {
                errorCallback(err || err2);
            });
        }

        ddb.updateTable(params, function (err, data) {
            if (err) {
                return tryRestore(err);
            }

            ddb.waitFor('tableExists', { TableName: tableName }, function(err, data2) {
                if (err) {
                    return tryRestore(err);
                }
                successCallback(oldReadCapacity, oldWriteCapacity, newReadCapacity); // fuckit, just assume the change worked
                                                                                     // I don't want to call another describe.
            });
        });
    })
}

DynamoBackup.prototype._restoreTable = function (tableName, oldReadCapacity, oldWriteCapacity, callback) {
    var self = this;
    var ddb = new AWS.DynamoDB();

    if (oldReadCapacity == null) {
        return callback();
    }

    var params = {
        TableName: tableName,
        ProvisionedThroughput: {
            ReadCapacityUnits: oldReadCapacity,
            WriteCapacityUnits: oldWriteCapacity
        }
    };

    // it takes a moment for dynamoDB to realize we're done reading
    var counter = 0;
    var update = function() {
        ddb.updateTable(params, function (err, data) {
            if (err) {
                if (counter > 15) { // 5 minute timeout
                    return callback(err);
                }
                if (err.code == 'ResourceInUseException') {
                    counter++;
                    return setTimeout(update, 20000);
                }
                return callback(err);
            }
            callback();
        });
    };
    setTimeout(update, 2000);
}

DynamoBackup.prototype._streamItems = function fetchItems(tableName, startKey, limit, segment, totalSegments, itemsReceived, callback) {
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
    if (segment) {
       params.Segment = segment;
       params.TotalSegments = totalSegments;
    }
    ddb.scan(params, function (err, data) {
        if (err) {
            return callback(err);
        }

        if (data.Items.length > 0) {
            itemsReceived(data.Items);
        }

        if (!data.LastEvaluatedKey || _.keys(data.LastEvaluatedKey).length === 0) {
            return callback();
        }
        self._streamItems(tableName, data.LastEvaluatedKey, limit, segment, totalSegments, itemsReceived, callback);
    });
};

DynamoBackup.prototype._fetchTables = function (lastTable, tables, callback) {
    var self = this;
    var ddb = new AWS.DynamoDB();
    var params = {};
    if (lastTable) {
        params.ExclusiveStartTableName = lastTable;
    }
    ddb.listTables(params, function (err, data) {
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

/**
 * AWS Data Pipeline import requires that each key in the Attribute list
 * be lower-cased and for sets start with a lower-case character followed
 * by an 'S'.
 *
 * Go through each attribute and create a new entry with the correct case
 */
DynamoBackup.prototype._formatForDataPipeline = function (item) {
    var self = this;
    _.each(item, function (value, key) {
        //value will be of the form: {S: 'xxx'}. Convert the key
        _.each(value, function (v, k) {
            var dataPipelineValueKey = self._getDataPipelineAttributeValueKey(k);
            value[dataPipelineValueKey] = v;
            value[k] = undefined;
            // for MAps and Lists, recurse until the elements are created with the correct case
            if(k === 'M' || k === 'L') {
              self._formatForDataPipeline(v);
            }
        });
    });
    return JSON.stringify(item);
};

DynamoBackup.prototype._getDataPipelineAttributeValueKey = function (type) {
    switch (type) {
        case 'S':
        case 'N':
        case 'B':
        case 'M':
        case 'L':
        case 'NULL':
            return type.toLowerCase();
        case 'BOOL':
            return 'bOOL';
        case 'SS':
            return 'sS';
        case 'NS':
            return 'nS';
        case 'BS':
            return 'bS';
        default:
            throw new Error('Unknown AttributeValue key: ' + type);
    }
};

module.exports = DynamoBackup;
