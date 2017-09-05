const _ = require('lodash');
const AWS = require('aws-sdk');
const events = require('events');
const moment = require('moment');
const path = require('path');
const async = require('async');
const util = require('util');
const Uploader = require('s3-streaming-upload').Uploader;
const ReadableStream = require('./readable-stream');

function DynamoBackup(options = {}) {
    this.excludedTables = options.excludedTables || [];
    this.includedTables = options.includedTables;
    this.readPercentage = options.readPercentage || .25;
    this.backupPath = options.backupPath;
    this.bucket = options.bucket;
    this.stopOnFailure = options.stopOnFailure || false;
    this.base64Binary = options.base64Binary || false;
    this.saveDataPipelineFormat = options.saveDataPipelineFormat || false;
    this.awsConfig = options.aws || {};
    this.debug = Boolean(options.debug);

    if (options.onRetry) {
        AWS.events.on('retry', options.onRetry);
    }

    AWS.config.update(this.awsConfig)
    this.dynamodb = new AWS.DynamoDB({ apiVersion: '2012-08-10' });
    this.s3 = new AWS.S3({ apiVersion: '2006-03-01' });
}

util.inherits(DynamoBackup, events.EventEmitter);

DynamoBackup.prototype.listTables = function (callback) {
    const self = this;
    self._fetchTables(null, [], callback);
};

DynamoBackup.prototype.backupTable = function (tableName, backupPath, callback) {
    const self = this;
    const stream = new ReadableStream();

    if (callback === undefined) {
        callback = backupPath;
        backupPath = self._getBackupPath();
    }

    const params = Object.assign({
        bucket: self.bucket,
        objectName: path.join(backupPath, tableName + '.json'),
        stream: stream,
        debug: self.debug,
    }, JSON.parse(JSON.stringify(self.awsConfig)))

    /**
     * Map key names if they're provided
     * since Uploader requires different naming
     */
    if (params.accessKeyId) {
        params.accessKey = params.accessKeyId
        params.secretKey = params.secretAccessKey
    }

    const upload = new Uploader(params);
    const startTime = moment.utc();

    self.emit('start-backup', tableName, startTime);
    upload.send(function (err) {
        if (err) {
            self.emit('error', {
                table: tableName,
                err: err
            });
        }
        const endTime = moment.utc();
        const backupDuration = endTime.diff(startTime);
        self.emit('end-backup', tableName, backupDuration);
        return callback(err);
    });

    self._copyTable(
        tableName,
        function (items) {
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
        },
        function (error) {
            stream.end();
            if (error) {
                self.emit('error', {
                    table: tableName,
                    error
                });
            }
        }
        );
};

DynamoBackup.prototype.backupAllTables = function (callback) {
    const self = this;
    const backupPath = self._getBackupPath();

    self.listTables(function (err, tables) {
        if (err) {
            return callback(err);
        }
        const includedTables = self.includedTables || tables;
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
    const self = this;
    const now = moment.utc();
    return self.backupPath || ('DynamoDB-backup-' + now.format('YYYY-MM-DD-HH-mm-ss'));
};

DynamoBackup.prototype._copyTable = function (tableName, itemsReceived, callback) {
    const self = this;
    self.dynamodb.describeTable({ TableName: tableName }, function (err, { Table: schema }) {
        if (err) {
            return callback(err);
        }

        const readPercentage = self.readPercentage;
        const limit = Math.max((schema.ProvisionedThroughput.ReadCapacityUnits * readPercentage) | 0, 1);

        async.parallel([
            cb => self._copySchema(tableName, schema, cb),
            cb => self._streamItems(tableName, null, limit, itemsReceived, cb)
        ], callback)
    });
};

DynamoBackup.prototype._streamItems = function fetchItems(tableName, startKey, limit, itemsReceived, callback) {
    const self = this;
    const params = {
        Limit: limit,
        ReturnConsumedCapacity: 'NONE',
        TableName: tableName
    };
    if (startKey) {
        params.ExclusiveStartKey = startKey;
    }
    self.dynamodb.scan(params, function (err, data) {
        if (err) {
            return callback(err);
        }

        if (data.Items.length > 0) {
            itemsReceived(data.Items);
        }

        if (!data.LastEvaluatedKey || _.keys(data.LastEvaluatedKey).length === 0) {
            return callback();
        }
        self._streamItems(tableName, data.LastEvaluatedKey, limit, itemsReceived, callback);
    });
};

DynamoBackup.prototype._copySchema = function (tableName, schema, callback) {
    const self = this;
    const backupPath = self._getBackupPath()
    const params = {
        Bucket: self.bucket,
        Body: JSON.stringify(schema),
        Key: path.join(backupPath, `${tableName}.schema.json`),
    }
    self.s3.upload(params, callback)
}

DynamoBackup.prototype._fetchTables = function (lastTable, tables, callback) {
    const self = this;
    const params = {};
    if (lastTable) {
        params.ExclusiveStartTableName = lastTable;
    }
    self.dynamodb.listTables(params, function (err, data) {
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
    const self = this;
    _.each(item, function (value, key) {
        //value will be of the form: {S: 'xxx'}. Convert the key
        _.each(value, function (v, k) {
            const dataPipelineValueKey = self._getDataPipelineAttributeValueKey(k);
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
