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
var events = require('events');
var readline = require('readline');
var DYNAMO_CHUNK_SIZE = 25;
var BUFFER_ITEMS;
var INTERVAL;

function DynamoRestore(options) {
    options = options || {};
    options.concurrency = options.concurrency && options.concurrency / DYNAMO_CHUNK_SIZE || 20;
    options.minConcurrency = 1;
    options.maxConcurrency = options.concurrency;
    options.readcapacity = options.readcapacity || 5;
    options.writecapacity = options.writecapacity || 0;
    options.stopOnFailure = options.stopOnFailure || false;
    options.awsKey = options.awsKey || process.env.AWS_ACCESS_KEY_ID;
    options.awsSecret = options.awsSecret || process.env.AWS_SECRET_ACCESS_KEY;
    options.awsRegion = options.awsRegion || process.env.AWS_DEFAULT_REGION || 'us-east-1';

    AWS.config.update({
        accessKeyId: options.awsKey,
        secretAccessKey: options.awsSecret,
        region: options.awsRegion
    });

    this.options = options;
    this.options.localfile = false;
    this.requests = 0;
    this.drain = false;
    this.requestItems = new Array();
    this.dynamodb = new AWS.DynamoDB();
    INTERVAL = 1000 / options.maxConcurrency;
    BUFFER_ITEMS = options.concurrency * DYNAMO_CHUNK_SIZE * 5; // 5s of comsumption
}

// Stick to prototypal inheritance. While this can be done differently
// in ES6 we'd be making package unusable for older engines (0.10.x->0.12.x)
util.inherits(DynamoRestore, events.EventEmitter);

DynamoRestore.prototype.run = function(finishCallback) {
    this._validateS3Backup(this.options);
    this._validateTable(this.options);
    this._startDownload();

    var self = this;
    // Exit program by default if there are no error listeners attached.
    this.on('error', function(message) {
        if (finishCallback) {
            finishCallback(message);
        }
        if (self.listeners('error').length <= 1) {
            throw new Error(message);
        }
    });
    // Finish off by updating write capacity to end-state (if needed)
    this.on('finish', function() {
        var dynamodb = self.dynamodb,
            options = self.options;
        // Do we need to update write capacity?
        if (options.writecapacity) {
            dynamodb.updateTable({
                TableName: options.table,
                ProvisionedThroughput: {
                    ReadCapacityUnits: options.readcapacity,
                    WriteCapacityUnits: options.writecapacity
                }
            }, finishCallback);
        } else {
            finishCallback();
        }
    });
};

DynamoRestore.prototype._validateS3Backup = function(options) {
    // Check S3 URI
    var url = URL.parse(options.source);
    if (!url || url.protocol !== 's3:') {
        if (fs.existsSync(options.source)) {
            return this.options.localfile = true;
        } else {
            return this.emit('error', 'Please provide an s3 URI or real file source (ie s3://mybucketname/folder/mydynamotable.json)');
        }
    }
    if (!url.pathname || !url.hostname || url.search || url.hash || url.auth) {
        return this.emit('error', 'Please provide a simple s3 URI as file source (ie s3://mybucketname/folder/mydynamotable.json)');
    }
    if (url.pathname.substr(-5).toLowerCase() !== '.json') {
        return this.emit('error', 'Please provide a *.json file as source restoring backup.');
    }
    // Break up into individual components
    options.s3bucket = url.hostname;
    options.s3path = url.pathname.substr(1);
    options.s3filename = url.pathname.split('.').pop();
};

DynamoRestore.prototype._validateTable = function(options) {
    var dynamodb = this.dynamodb;
    if (!options.table) {
        return this.emit('error', 'Please provide a Dynamo DB table name to restore to.');
    }
    dynamodb.listTables({}, this._checkTableExists.bind(this));
};

DynamoRestore.prototype._checkTableExists = function(error, data) {
    var dynamodb = this.dynamodb;
    if (error || !data || !data.TableNames) {
        return this.emit('error', 'Fatal Error. Could not connect to AWS DynamoDB engine. Please check your credentials.');
    }
    if (data.TableNames.indexOf(this.options.table) > -1) {
        // Table exists, should we overwrite it??
        if (this.options.overwrite) {
            this.emit('warning', util.format('WARN: table [%s] will be overwritten.', this.options.table));
            setTimeout(dynamodb.describeTable.bind(dynamodb, { TableName: this.options.table }, this._checkTableReady.bind(this)), 1000);
        } else {
            this.emit('error', 'Fatal Error. The destination table already exists! Exiting process..');
        }
        return;
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
    var options = this.options;
    var self = this;

    var createReadline = function(stream, meta) {
        self.emit('start-download', meta);
        self.readline = readline.createInterface({
                terminal: false,
                input: stream
            })
            .on('line', self._processLine.bind(self))
            .on('close', function() {
                self.emit('finish-download');
                this.drain = true;
            });
        self.readline.meta = meta;
        self.readline.meta.RemainingLength = meta.ContentLength;
    }

    if (options.localfile) {
        fileStream = fs.ReadStream(options.source);
        meta = {ContentLength: fs.statSync(options.source).size};
        createReadline(fileStream, meta);
    } else {
        var s3 = new AWS.S3();
        var params = {
            Bucket: self.options.s3bucket,
            Key: self.options.s3path
        };
        // First determine if file exists in s3
        s3.headObject(params, function(error, meta) {
            if (error) {
                if (error.code === 'NotFound') self.emit('error', util.format('Could not find file in s3. %s', self.options.source));
                else self.emit('error', util.format('Error downloading file from s3: %s', error));
                return;
            }
            var downloadStream = s3.getObject(params).createReadStream();
            downloadStream.pause();
            // All good, start downloading
            createReadline(downloadStream, meta);
        });
    };
};

DynamoRestore.prototype._processFirstLine = function(line) {
    item = JSON.parse(line);
    this.template = this._extractSchema(item);
    this.requestItems.push({ PutRequest: { Item: item } });
}

DynamoRestore.prototype._processLine = function(line) {
    // First Line?
    if (!this.template) {
        this.readline.pause();
        this._processFirstLine(line);
    } else {
        item = JSON.parse(line);
        this.requestItems.push({ PutRequest: { Item: item } });
    }
    this.readline.meta.RemainingLength -= line.length + 1;
};

DynamoRestore.prototype._extractSchema = function(template) {
    var partitionkey = this.options.partitionkey;
    if (partitionkey) {
        // Check it actually exists
        if (!template[partitionkey]) {
            return this.emit('error', util.format('Fatal Error. The --partitionkey "%s" you provided is not a valid column.', partitionkey));
        }
    } else {
        // Or if unkonwn, find the most likely candidate
        var likelyCandidates = Object.keys(template).filter(function(column) {
            return column.toLowerCase().substr(-2) === 'id' ||
                column.toLowerCase().substr(-3) === 'key' ||
                column.toLowerCase().substr(-3) === 'ref';
        });
        if (likelyCandidates.length === 0) {
            return this.emit('error', 'Fatal Error. Cannot determine --partitionkey from backup, please supply it manually.');
        } else {
            // Pick the shortest one
            partitionkey = likelyCandidates.sort(function(a, b) {
                return b.length - a.length;
            }).pop();
        }
        this.options.partitionkey = partitionkey;
        this.options.sortkey = undefined;
    }
    // And find the type for each primary and secondary
    this.options.partitionkeytype = Object.keys(template[partitionkey]).pop();
    if (this.options.sortkey) {
        var sortkey = this.options.sortkey;
        if (!template[sortkey]) {
            return this.emit('error', 'Fatal Error. The --sortkey you provided is not available for some records.');
        }
        this.options.sortkeytype = Object.keys(template[sortkey]).pop();
    }
    return template;
};

DynamoRestore.prototype._createTable = function(callback) {
    var dynamodb = this.dynamodb,
        options = this.options;
    if (!options.table || !options.partitionkey) {
        return this.emit('error', 'Fatal Error. Could not create dynamo table. Not enough information provided.');
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
            WriteCapacityUnits: options.concurrency * DYNAMO_CHUNK_SIZE // Need this high for pumping data, but will reduce it later.
        }
    };
    if (options.sortkey) {
        params.AttributeDefinitions.push({
            AttributeName: options.sortkey,
            AttributeType: options.sortkeytype
        });
        params.KeySchema.push({
            AttributeName: options.sortkey,
            KeyType: 'RANGE'
        });
    }
    dynamodb.createTable(params, (function(error, data) {
        if (error || !data) {
            return this.emit('error', 'Fatal Error. Failed to create new table. ' + error);
        }
        data = data.TableDescription;
        // Wait before hammering table..
        setTimeout(dynamodb.describeTable.bind(dynamodb, { TableName: data.TableName }, this._checkTableReady.bind(this)), 5000);
    }).bind(this));
};

DynamoRestore.prototype._checkTableReady = function(error, data) {
    var dynamodb = this.dynamodb;
    if (error || !data || !data.Table) {
        return this.emit('error', 'Error creating table ' + this.options.table);
    }
    if (data &&
        data.Table &&
        data.Table.TableStatus === 'ACTIVE') {
        // All ready, now we can start inserting records
        this.tableready = true;
        this.readline.resume();
        this._sendBatchLoop();
    } else {
        setTimeout(dynamodb.describeTable.bind(dynamodb, { TableName: data.Table.TableName }, this._checkTableReady.bind(this)), 1000);
    }
};

DynamoRestore.prototype._sendBatchLoop = function() {
    if (this.requestItems.length >= DYNAMO_CHUNK_SIZE || this.drain) {
        // Prepare
        var params = { RequestItems: {} },
            options = this.options,
            items = this.requestItems.splice(0, DYNAMO_CHUNK_SIZE);
            self = this;
        params.RequestItems[options.table] = items;

        // Send
        if (self.requests < options.concurrency) {
            self.requests++;
            self.emit('send-batch', self.requests, self.requestItems.length, self.readline.meta);
            self.dynamodb.batchWriteItem(params, function(error, data) {
                self.requests--;
                if (error) {
                    self.emit('warning', 'Error processing batch, putting back in the queue.');
                    self.requestItems.push.apply(self.requestItems, items);
                    return;
                }
                var unprocessedItems = data && data.UnprocessedItems && data.UnprocessedItems[options.table] || [];
                if (unprocessedItems.length) {
                    // Retry unprocessed items
                    self.emit('warning', unprocessedItems.length + ' unprocessed items. Add to queue and back off a bit.');
                    self.requestItems.push.apply(self.requestItems, unprocessedItems);
                    // Back off a bit..
                    if (options.concurrency > options.minConcurrency) {
                        options.concurrency--;
                    }
                } else {
                    // Successful upload, increase concurrency again..
                    if (options.concurrency < options.maxConcurrency) {
                        options.concurrency++;
                    }
                }
                // Continue downloading data...
                self.emit('finish-batch', self.requests);
            });
        }
    } if (this.requestItems.length >= BUFFER_ITEMS) {
        this.readline.pause();
    } else {
        this.readline.resume();
    }
    if (this.drain && this.requestItems.length === 0 && this.requests === 0) {
        this.emit('finish');
    } else {
        setTimeout(this._sendBatchLoop.bind(this), INTERVAL);
    }
};

module.exports = DynamoRestore;
