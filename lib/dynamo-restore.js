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
    options.concurrency = options.concurrency || 200;
    options.minConcurrency = 1;
    options.maxConcurrency = options.concurrency;
    options.readcapacity = options.readcapacity || 5;
    options.writecapacity = options.writecapacity || 0;
    options.stopOnFailure = options.stopOnFailure || false;
    options.awsKey = options.awsKey || process.env.AWS_ACCESS_KEY_ID;
    options.awsSecret = options.awsSecret || process.env.AWS_SECRET_ACCESS_KEY;
    options.awsRegion = options.awsRegion || process.env.AWS_DEFAULT_REGION || 'ap-southeast-2';
    options.awsSessionToken = options.awsSessionToken || process.env.AWS_SESSION_TOKEN;

    AWS.config.update({
        accessKeyId: options.awsKey,
        secretAccessKey: options.awsSecret,
        region: options.awsRegion,
        sessionToken: options.awsSessionToken
    });

    this.options = options;
    this.dynamodb = new AWS.DynamoDB();
}

// Stick to prototypal inheritance. While this can be done differently 
// in ES6 we'd be making package unusable for older engines (0.10.x->0.12.x)
util.inherits(DynamoRestore, events.EventEmitter);

DynamoRestore.prototype.run = function(finishCallback) {
    this._validateS3Backup(this.options);
    this._validateTable(this.options);
    this._startDownload();
    // Exit program by default if there are no error listeners attached.
    this.on('error', (function(message) {
        if (finishCallback) {
            finishCallback(message);
        }
        if (this.listeners('error').length <= 1) {
            throw new Error(message);
        }
    }).bind(this));
    // Finish off by updating write capacity to end-state (if needed)
    this.on('finish', (function() {
        var dynamodb = this.dynamodb,
            options = this.options;
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
    }).bind(this));
};

DynamoRestore.prototype._validateS3Backup = function(options) {
    // Check S3 URI
    var url = URL.parse(options.source);
    if (!url || url.protocol !== 's3:') {
        return this.emit('error', 'Please provide an s3 URI as file source (ie s3://mybucketname/folder/mydynamotable.json)');
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
    var s3 = new AWS.S3();
    var params = {
        Bucket: this.options.s3bucket,
        Key: this.options.s3path
    };
    // First determine if file exists in s3
    s3.headObject(params, (function(error, meta) {
        if (error) {
            if (error.code === 'NotFound') this.emit('error', util.format('Could not find file in s3. %s', this.options.source));
            else this.emit('error', util.format('Error downloading file from s3: %s', error));
            return;
        }
        var downloadStream = s3.getObject(params).createReadStream();
        downloadStream.pause();
        // All good, start downloading 
        this.emit('start-download', meta);
        this.readline = readline.createInterface({
                terminal: false,
                input: downloadStream
            })
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
    else if (this.tableready && this.batches.length) {
        this._sendBatch();
    }
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
            WriteCapacityUnits: options.concurrency // Need this high for pumping data, but will reduce it later.
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
        while (this.batches.length) { this._sendBatch(); }
    } else {
        setTimeout(dynamodb.describeTable.bind(dynamodb, { TableName: data.Table.TableName }, this._checkTableReady.bind(this)), 1000);
    }
};

DynamoRestore.prototype._sendBatch = function() {
    // Prepare
    var params = { RequestItems: {} },
        dynamo = this.dynamodb,
        options = this.options;
    batch = this.batches.shift();
    params.RequestItems[options.table] = batch.items;

    // Send
    this.requests.push(dynamo.batchWriteItem(params, (function(error, data) {
        this.requests.shift();
        if (error) {
            // Problem? Check the number of attempts
            if (batch.attempts > options.concurrency) {
                if (options.stopOnFailure) {
                    return this.emit('error', 'Fatal Error. Failed to upload batch. Ending process. \n' + JSON.stringify(batch));
                } else {
                    this.emit('warning', 'Failed to upload same batch too many times, removing from queue.. \n' + JSON.stringify(batch));
                }
            } else {
                this.emit('warning', 'Error processing batch, putting back in the queue.');
                batch.attempts++;
                this.batches.push(batch);
            }
        }
        var unprocessedItems = data && data.UnprocessedItems && data.UnprocessedItems[options.table] || [];
        if (unprocessedItems.length) {
            // Retry unprocessed items
            this.emit('warning', unprocessedItems.length + ' unprocessed items. Add to queue and back off a bit.');
            this.batches.push({
                items: unprocessedItems,
                attempts: batch.attempts + 1
            });
            // Back off a bit..
            options.concurrency--;
            if (options.concurrency < options.minConcurrency) {
                options.concurrency = options.minConcurrency;
            }
        } else {
            // Successful upload, increase concurrency again..
            options.concurrency++;
            if (options.concurrency > options.maxConcurrency) {
                options.concurrency = options.maxConcurrency;
            }
        }
        // Continue downloading data...
        if (this.tableready && this.requests.length < options.concurrency * 0.8) {
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
};

module.exports = DynamoRestore;