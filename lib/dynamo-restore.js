const URL = require('url')
const util = require('util')
const AWS = require('aws-sdk')
const async = require('async')
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
    this.schema = {}
    this.batches = []
    this.requests = []
    this.requestItems = []
    this.contentLength = 0
    this.restoredLength = 0
}

util.inherits(DynamoRestore, events.EventEmitter)

DynamoRestore.prototype.run = function () {
    const self = this
    self.emit('start')

    const emitErrorAndFinish = error => {
        self.emit('error', error)
        self.emit('finish')
        return false
    }

    if (!self.options.table) {
        return emitErrorAndFinish(new Error('Please provide a Dynamo DB table name to restore.'))
    }

    if (!self.options.bucket) {
        return emitErrorAndFinish(new Error('Please provide "bucket" name.'))
    }

    if (!self.options.restorePath) {
        return emitErrorAndFinish(new Error('Please provide the path inside bucket holding backups as "restorePath".'))
    }

    async.series([
        done => self._verifyBackupFilesExist(done),
        done => self._fetchSchema(done),
        done => self._createTableIfNeeded(done),
        done => self._startDownload(done),
        done => self._cleanup(done)
    ], error => {
        if (error) self.emit('error', error)
        self.emit('finish')
    })
}

DynamoRestore.prototype._verifyBackupFilesExist = function (callback) {
    const self = this

    function checkSchemaFile (done) {
        const schemaPath = `${self.options.restorePath}/${self.options.table}.schema.json`
        const params = { Bucket: self.options.bucket, Key: schemaPath }

        self.s3.headObject(params, (error, metadata) => {
            if (error) {
                error.message = `Schema "${schemaPath}" not found in  "${self.options.bucket}" bucket.` + (error.message || '')
                return done(error)
            }
            self.emit('info', `Schema file found at s3://${self.options.bucket}/${schemaPath}`)
            return done(null, metadata)
        })
    }

    function checkBackupFile (done) {
        const backupPath = `${self.options.restorePath}/${self.options.table}.json`
        const params = { Bucket: self.options.bucket, Key: backupPath }

        self.s3.headObject(params, (error, metadata) => {
            if (error) {
                error.message = `Backup "${backupPath}" not found in  "${self.options.bucket}" bucket.` + (error.message || '')
                return done(error)
            }
            self.emit('info', `Backup file found at s3://${self.options.bucket}/${backupPath}`)
            self.contentLength = metadata.ContentLength
            return done(null, metadata)
        })
    }

    return async.parallel([checkSchemaFile, checkBackupFile], callback)
}

DynamoRestore.prototype._fetchSchema = function (callback) {
    const self = this
    const schemaPath = `${self.options.restorePath}/${self.options.table}.schema.json`
    const params = {
        Bucket: self.options.bucket,
        Key: schemaPath
    }

    function parseSchema (error, { Body }) {
        if (error) return callback(error)

        const schemaStr = Body.toString('utf-8')
        try {
            self.schema = JSON.parse(schemaStr)
            return callback()
        } catch (error) {
            return callback(error)
        }
    }

    self.emit('info', 'Schema is fetched successfully')
    return self.s3.getObject(params, parseSchema)
}

DynamoRestore.prototype._createTableIfNeeded = function (callback) {
    const self = this

    self._isTableExists((error, exists) => {
        if (error) return callback(error)
        if (exists) {
            self.emit('info', `Table [${self.options.table}] already exists.`)
            self._updateTableIfRequired(callback)
        } else {
            self.emit('info', `Table [${self.options.table}] does not exist.`)
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
    self.emit('info', `Creating table [${self.options.table}]...`)

    self.dynamodb.createTable(params, (error, data) => {
        if (error) return callback(error)

        // Wait before hammering table
        self.emit('info', `Table [${self.options.table}] is created successfully.`)
        return self._waitUntilTableIsReady(callback, timeout=5000)
    })
}

DynamoRestore.prototype._updateTable = function (callback) {
    const self = this
    const params = self._convertSchemaToRequestParams()

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
            self.emit('info', `Table is created and is ready. Current status: ${Table.TableStatus}`)
            return callback()
        }

        self.emit('info', `Waiting for table to be ready. Current status: ${Table.TableStatus}`)
        setTimeout(() => {
            self._waitUntilTableIsReady(callback)
        }, timeout)
    })
}

DynamoRestore.prototype._convertSchemaToRequestParams = function () {
    const self = this

    // Object.assign does not deep copy;
    // causing nested objects such as "ProvisionedThroughput" to be mutable
    const params = JSON.parse(JSON.stringify(self.schema))

    // these attributes should not be in the request params
    // otherwise aws will throw invalidation error
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

    const downloadStream = self.s3.getObject(params).createReadStream()
    downloadStream.pause()

    self.emit('info', 'Start downloading from s3.')
    self.emit('progress', 0)
    self.readline = readline.createInterface({ terminal: false, input: downloadStream })
    self.readline.on('line', line => self._processLine(line))
    self.readline.on('close', () => {
        self.emit('info', 'Downloading from s3 finished.')
        self.batches.push({
            items: self.requestItems.splice(0, DYNAMO_CHUNK_SIZE),
            attempts: 0
        })
        self._finishBatches(callback)
    })
}

DynamoRestore.prototype._processLine = function (line) {
    const self = this

    // Keep tabs on how much data is being consumed
    self.restoredLength = line.length + 1

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

    batch = self.batches.shift()
    params.RequestItems[self.options.table] = batch.items

    self.requests.push(self.dynamodb.batchWriteItem(params, function (error, data) {
        self.requests.shift()
        if (error) {
            // Problem? Check the number of attempts
            if (batch.attempts > self.options.concurrency) {
                if (self.options.stopOnFailure) {
                    return self.emit('error', 'Fatal Error. Failed to upload batch. Ending process. \n' + JSON.stringify(batch))
                } else {
                    self.emit('warning', 'Failed to upload same batch too many times, removing from queue.. \n' + JSON.stringify(batch))
                }
            } else {
                self.emit('warning', 'Error processing batch, putting back in the queue.')
                batch.attempts++
                self.batches.push(batch)
            }
        }
        const unprocessedItems = data && data.UnprocessedItems && data.UnprocessedItems[self.options.table] || []
        if (unprocessedItems.length) {
            // Retry unprocessed items
            self.emit('warning', `${unprocessedItems.length} unprocessed items. Add to queue and back off a bit.`)
            self.batches.push({
                items: unprocessedItems,
                attempts: batch.attempts + 1
            })
            // Back off a bit..
            self.options.concurrency--
            if (self.options.concurrency < self.options.minConcurrency) {
                self.options.concurrency = self.options.minConcurrency
            }
        } else {
            // Successful upload, increase concurrency again..
            self.options.concurrency++
            if (self.options.concurrency > self.options.maxConcurrency) {
                self.options.concurrency = self.options.maxConcurrency
            }
        }
        // Continue downloading data...
        if (self.requests.length < self.options.concurrency * 0.8) {
            self.readline.resume()
        }
    }))

    const progressPercent = (self.restoredLength / self.contentLength) * 100
    self.emit('progress', progressPercent)
}

DynamoRestore.prototype._finishBatches = function (callback) {
    const self = this
    if (!self.batches.length) {
        if (!self.requests.length) {
            self.emit('progress', 100)
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
}

DynamoRestore.prototype._cleanup = function (callback) {
    const self = this
    const params = {
        TableName: self.options.table,
        ProvisionedThroughput: {
            ReadCapacityUnits: self.schema.ProvisionedThroughput.ReadCapacityUnits,
            WriteCapacityUnits: self.schema.ProvisionedThroughput.WriteCapacityUnits
        }
    }

    self.emit('info', `Reverting back writeCapacity to ${params.ProvisionedThroughput.WriteCapacityUnits}`)
    return self.dynamodb.updateTable(params, error => {
        /**
         * In case the write throughput is provisioned exactly
         * as schema via options.concurrency value,
         * aws will throw an validationException:
         * "The provisioned throughput for the table will not change.
         * The requested value equals the current value."
         */
        if (error) self.emit('warning', error)
        return callback()
    })
}

module.exports = DynamoRestore
