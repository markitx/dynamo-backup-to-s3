const URL = require('url')
const util = require('util')
const AWS = require('aws-sdk')
const events = require('events')
const readline = require('readline')
const DYNAMO_CHUNK_SIZE = 25

function DynamoRestore(options = {}) {
    const defaults = {
        /**
         * The bucket that contains backups
         */
        bucket: '',

        /**
         * Name of the table that needs to be restored
         */
        table: null,

        /**
         * The directory inside bucket that contains that particular backup.
         * eg. Dynamodb-backup-2000-12-25-17:56:48
         */
        restorePath: '',
        concurrency: 200,
        minConcurrency: 1,
        stopOnFailure: false,

        /**
         * Overwrite table's config if table exists.
         * Will throw error if overwrite is false and table exists
         */
        overwrite: false,
        schema: {},
        aws: {
            region: process.env.AWS_DEFAULT_REGION,
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
    }

    this.options = Object.assign({}, defaults, options)
    AWS.config.update(this.options.aws)

    this.dynamodb = new AWS.DynamoDB({ apiVersion: '2012-08-10' })
    this.s3 = new AWS.S3({ apiVersion: '2006-03-01' })
}

util.inherits(DynamoRestore, events.EventEmitter)

DynamoRestore.prototype.run = function () {
    const self = this
    try {
        self._validateOptions(self.options)
    } catch (error) {
        self.emit('error', error)
        self.emit('end-restore')
        return false
    }

    self._fetchSchema((error, { Body }) => {
        if (error) {
            self.emit('error', error)
            self.emit('end-restore')
            return false
        }

        const schemaStr = Body.toString('utf-8')
        try {
            self.options.schema = JSON.parse(schemaStr)
        } catch (error) {
            self.emit('error', error)
            self.emit('end-restore')
            return false
        }

        self._createTableIfNeeded(error => {
            if (error) {
                self.emit('error', error)
                self.emit('end-restore')
                return false
            }
            console.log('=============>', 'done :)')
            // self._startDownload()

            self.emit('end-restore')
        })
    })

    // // Exit program by default if there are no error listeners attached.
    // self.on('error', function (message) {
    //     if (finishCallback) {
    //         finishCallback(message)
    //     }
    //     if (self.listeners('error').length <= 1) {
    //         throw new Error(message)
    //     }
    // })

    // // Finish off by updating write capacity to end-state (if needed)
    // self.on('finish', function () {
    //     if (self.options.writecapacity) {
    //         self.dynamodb.updateTable({
    //             TableName: self.options.table,
    //             ProvisionedThroughput: {
    //                 ReadCapacityUnits: self.options.readcapacity,
    //                 WriteCapacityUnits: self.options.writecapacity
    //             }
    //         }, finishCallback)
    //     } else {
    //         finishCallback()
    //     }
    // })
}



DynamoRestore.prototype._getKeyFromSchema = function (keyType) {
    const keySchemas = this.options.schema.KeySchema || {}
    return keySchemas.find(ks => ks.KeyType === keyType) || {}
}

DynamoRestore.prototype._getHashKeyFromSchema = function () {
    return this._getKeyFromSchema('HASH').AttributeName
}

DynamoRestore.prototype._getRangeKeyFromSchema = function () {
    return this._getKeyFromSchema('RANGE').AttributeName
}

DynamoRestore.prototype._getProvisionedThroughputFromSchema = function () {
    return this.options.schema.ProvisionedThroughput || {}
}

DynamoRestore.prototype._validateOptions = function (options) {
    if (!options.table) {
        throw new Error('Please provide a Dynamo DB table name to restore to.')
    }

    if (!options.bucket) {
        throw new Error('Please provide "bucket" name.')
    }

    if (!options.restorePath) {
        throw new Error('Please provide the path inside bucket holding backups as "restorePath".')
    }
}

DynamoRestore.prototype._fetchSchema = function (callback) {
    const self = this
    const schemaPath = `${self.options.restorePath}/${self.options.table}.schema.json`
    const params = {
        Bucket: self.options.bucket,
        Key: schemaPath
    }

    return self.s3.getObject(params, callback)
}

DynamoRestore.prototype._createTableIfNeeded = function (callback) {
    const self = this

    console.log('=============>', '_createTableIfNeeded')
    self._isTableExists((error, exists) => {
        if (error) return callback(error)
        if (exists) {
            console.log('=============>', 'table exists')
            self._updateTableIfRequired(callback)
        } else {
            self._createTable(callback)
        }
    })
}

DynamoRestore.prototype._isTableExists = function (callback) {
    const self = this

    self._fetchTables((error, tables) => {
        if (error) return callback(error)
        const exists = tables.includes(self.options.table)
        return callback(null, exists)
    })
}

DynamoRestore.prototype._fetchTables = function (callback, params = {}, currentList = []) {
    const self = this
    self.dynamodb.listTables(params, function (error, data) {
        if (error) return callback(error)
        const { TableNames, LastEvaluatedTableName } = data
        const hasNextPage = LastEvaluatedTableName && TableNames.length === 100
        currentList = currentList.concat(TableNames)

        if (hasNextPage) {
            return self._fetchTables(callback, { ExclusiveStartTableName: LastEvaluatedTableName }, currentList)
        }

        return callback(null, currentList)
    })
}

DynamoRestore.prototype._updateTableIfRequired = function (callback) {
    const self = this
    if (!self.options.overwrite) {
        const error = new Error(`Fatal Error. The table [${self.options.table}] already exists! Exiting process.`)
        return callback(error)
    }

    // Is updating table really necessary?
    // return self._updateTable(callback)
    return self._waitUntilTableIsReady(callback, timeout=1000)
}

DynamoRestore.prototype._createTable = function (callback) {
    const self = this
    const params = self._convertSchemaToRequestParams()

    self.dynamodb.createTable(params, (error, data) => {
        if (error) return callback(error)

        // Wait before hammering table..
        return self._waitUntilTableIsReady(callback, timeout=5000)
    })
}

DynamoRestore.prototype._updateTable = function (callback) {
    const self = this
    const params = self._convertSchemaToRequestParams(update=true)

    self.emit('warning', `Table [${self.options.table}] will be overwritten.`)
    self.dynamodb.updateTable(params, (error, data) => {
        if (error) return callback(error)

        // Wait before hammering table..
        return self._waitUntilTableIsReady(callback, timeout=5000)
    })
}

DynamoRestore.prototype._waitUntilTableIsReady = function (callback, timeout=1000) {
    const self = this
    self.dynamodb.describeTable({ TableName: self.options.table }, (error, { Table }) => {
        if (error) return callback(error)
        if (Table && Table.TableStatus === 'ACTIVE') {
            return callback()
        }

        setTimeout(() => {
            self._waitUntilTableIsReady(callback)
        }, timeout)
    })
}

DynamoRestore.prototype._convertSchemaToRequestParams = function (isUpdate=false) {
    const self = this
    const params = Object.assign({}, self.options.schema)
    const blacklistAttributes = [ 'TableStatus'
                                , 'CreationDateTime'
                                , 'TableSizeBytes'
                                , 'ItemCount'
                                , 'TableArn'
                                , 'LatestStreamLabel'
                                , 'LatestStreamArn'
                                , 'LastDecreaseDateTime'
                                , 'NumberOfDecreasesToday'
                                ]

    for (attr of blacklistAttributes) {
        delete params[attr]
        delete params.ProvisionedThroughput[attr]
    }

    // Need this high for pumping data, but will reduce it later.
    params.ProvisionedThroughput.WriteCapacityUnits = self.options.concurrency

    return params
}






DynamoRestore.prototype._startDownload = function () {
    const self = this
    const params = {
        Bucket: this.options.s3bucket,
        Key: this.options.s3path
    }

    // First determine if file exists in s3
    self.s3.headObject(params, (function (error, meta) {
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
            .on('close', (function () {
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

DynamoRestore.prototype._processLine = function (line) {
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

DynamoRestore.prototype._extractSchema = function (template) {
    var partitionkey = this.options.partitionkey;
    if (partitionkey) {
        // Check it actually exists
        if (!template[partitionkey]) {
            return this.emit('error', util.format('Fatal Error. The --partitionkey "%s" you provided is not a valid column.', partitionkey));
        }
    } else {
        // Or if unkonwn, find the most likely candidate
        var likelyCandidates = Object.keys(template).filter(function (column) {
            return column.toLowerCase().substr(-2) === 'id' ||
                column.toLowerCase().substr(-3) === 'key' ||
                column.toLowerCase().substr(-3) === 'ref';
        });
        if (likelyCandidates.length === 0) {
            return this.emit('error', 'Fatal Error. Cannot determine --partitionkey from backup, please supply it manually.');
        } else {
            // Pick the shortest one
            partitionkey = likelyCandidates.sort(function (a, b) {
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



DynamoRestore.prototype._sendBatch = function () {
    // Prepare
    var params = { RequestItems: {} },
        dynamo = this.dynamodb,
        options = this.options;
    batch = this.batches.shift();
    params.RequestItems[options.table] = batch.items;

    // Send
    this.requests.push(dynamo.batchWriteItem(params, (function (error, data) {
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

DynamoRestore.prototype._finishBatches = function () {
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
