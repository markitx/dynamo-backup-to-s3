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
        },
        batches: [],
        requests: [],
        requestItems: []
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

            self._startDownload(error => {
                if (error) self.emit('error', error)
                self.emit('end-restore')
            })
        })
    })

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

    self._isTableExists((error, exists) => {
        if (error) return callback(error)
        if (exists) {
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

        // Wait before hammering table
        return self._waitUntilTableIsReady(callback, timeout=5000)
    })
}

DynamoRestore.prototype._updateTable = function (callback) {
    const self = this
    const params = self._convertSchemaToRequestParams(update=true)

    self.emit('warning', `Table [${self.options.table}] will be overwritten.`)
    self.dynamodb.updateTable(params, (error, data) => {
        if (error) return callback(error)

        // Wait before hammering table
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

DynamoRestore.prototype._startDownload = function (callback) {
    const self = this
    const backupFilePath = `${self.options.restorePath}/${self.options.table}.json`
    const params = {
        Bucket: self.options.bucket,
        Key: backupFilePath
    }

    // First determine if file exists in s3
    self.s3.headObject(params, (error, meta) => {
        if (error) return callback(error)
        const downloadStream = self.s3.getObject(params).createReadStream()
        downloadStream.pause()
        // All good, start downloading
        self.emit('start-download', meta)
        self.readline = readline
            .createInterface({
                terminal: false,
                input: downloadStream
            })
            .on('line', line => self._processLine(line))
            .on('close', () => {
                self.emit('finish-download')
                self.batches.push({
                    items: self.requestItems.splice(0, DYNAMO_CHUNK_SIZE),
                    attempts: 0
                })
                self._finishBatches(callback)
            })
        self.readline.meta = meta
        self.readline.meta.RemainingLength = meta.ContentLength
    })
}

DynamoRestore.prototype._processLine = function (line) {
    const self = this

    // Keep tabs on how much data is being consumed
    self.readline.meta.RemainingLength -= line.length + 1

    // Create batches of 25 records each
    self.requestItems.push({ PutRequest: { Item: JSON.parse(line) } })

    if (self.requestItems.length === DYNAMO_CHUNK_SIZE) {
        self.batches.push({
            items: self.requestItems.splice(0, DYNAMO_CHUNK_SIZE),
            attempts: 0
        })
    }

    // Writing to Dynamo is usually slower than reading from S3,
    // and we want to avoid clogging up memory or writing to disk.
    // The list of batches waiting for DynamoDB to process would
    // quickly get out of hand here, so an easy way around this is to
    // stop reading from S3 when the number of requests in flight goes past a
    // certain size, and then continue reading when the number is reduced.
    if (self.requests.length >= self.options.concurrency) {
        //Too many requests! Pausing download..
        self.readline.pause()
    }
    // Send the next batch if we are not exceeding concurrency (ie max requests)
    else if (self.batches.length) {
        self._sendBatch()
    }
}

DynamoRestore.prototype._sendBatch = function () {
    const self = this
    const params = { RequestItems: {} }

    batch = self.batches.shift();
    params.RequestItems[options.table] = batch.items;

    // Send
    self.requests.push(dynamo.batchWriteItem(params, function (error, data) {
        self.requests.shift();
        if (error) {
            // Problem? Check the number of attempts
            if (batch.attempts > options.concurrency) {
                if (options.stopOnFailure) {
                    return self.emit('error', 'Fatal Error. Failed to upload batch. Ending process. \n' + JSON.stringify(batch));
                } else {
                    self.emit('warning', 'Failed to upload same batch too many times, removing from queue.. \n' + JSON.stringify(batch));
                }
            } else {
                self.emit('warning', 'Error processing batch, putting back in the queue.');
                batch.attempts++;
                self.batches.push(batch);
            }
        }
        var unprocessedItems = data && data.UnprocessedItems && data.UnprocessedItems[options.table] || [];
        if (unprocessedItems.length) {
            // Retry unprocessed items
            self.emit('warning', unprocessedItems.length + ' unprocessed items. Add to queue and back off a bit.');
            self.batches.push({
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
        if (self.requests.length < options.concurrency * 0.8) {
            self.readline.resume();
        }
        self.emit('finish-batch', self.requests.length);
    }))

    // Notify
    self.emit('send-batch', self.batches.length, self.requests.length, self.readline.meta)
};

DynamoRestore.prototype._finishBatches = function (callback) {
    const self = this
    if (!self.batches.length) {
        if (!self.requests.length) {
            return callback()
        }
    } else {
        // Send remaining batches
        if (self.requests.length < self.options.concurrency) {
            self._sendBatch()
        }
    }
    // Repeat until finished
    setTimeout(() => self._finishBatches(callback), 200)
};

module.exports = DynamoRestore;
