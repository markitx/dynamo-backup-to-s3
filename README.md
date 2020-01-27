# dynamo-backup-to-s3

![dynamo to s3](https://raw.githubusercontent.com/sdesalas/dynamo-backup-to-s3/master/img/dynamo-backup-to-s3.png)

## Stream DynamoDB backups to S3.

dynamo-backup-to-s3 is a utility to stream DynamoDB data to S3.  Since the data is streamed directly from DynamoDB to S3 it is suitable for copying large tables directly. Tables are copied in parallel.

Can be run as a command line script or as an npm module.

# Command line usage

```
  Usage: dynamo-backup-to-s3 [options]

  Options:

    -h, --help                       output usage information
    -V, --version                    output the version number
    -b, --bucket <name>              S3 bucket to store backups
    -s, --stop-on-failure            specify the reporter to use
    -r, --read-percentage <decimal>  specific the percentage of Dynamo read capacity to use while backing up. default .25 (25%)
    -x, --excluded-tables <list>     exclude these tables from backup
    -i, --included-tables <list>     only backup these tables
    -p, --backup-path <name>         backup path to store table dumps in. default is DynamoDB-backup-YYYY-MM-DD-HH-mm-ss
    -e, --base64-encode-binary       if passed, encode binary fields in base64 before exporting
    -d, --save-datapipeline-format   save in format compatible with the AWS datapipeline import. Default to false (save as exported by DynamoDb)
    --aws-key                        AWS access key. Will use AWS_ACCESS_KEY_ID env var if --aws-key not set
    --aws-secret                     AWS secret key. Will use AWS_SECRET_ACCESS_KEY env var if --aws-secret not set
    --aws-region                     AWS region. Will use AWS_DEFAULT_REGION env var if --aws-region not set
	--session-token					 AWS session token. Used when assuming role. Will use AWS_SESSION_TOKEN env var if --session-token not set
```

# npm module usage

## Quick Example

```
var DynamoBackup = require('dynamo-backup-to-s3');

var backup = new DynamoBackup({
    excludedTables: ['development-table1', 'development-table2'],
    readPercentage: .5,
    bucket: 'my-backups',
    stopOnFailure: true,
    base64Binary: true,
    awsAccessKey: /* AWS access key */,
    awsSecretKey: /* AWS secret key */,
    awsRegion: /* AWS region */
});

backup.on('error', function(data) {
    console.log('Error backing up ' + data.table);
    console.log(data.err);
});

backup.on('start-backup', function(tableName, startTime) {
    console.log('Starting to copy table ' + tableName);
});

backup.on('end-backup', function(tableName, backupDuration) {
    console.log('Done copying table ' + tableName);
});

backup.backupAllTables(function() {
    console.log('Finished backing up DynamoDB');
});

```


## Documentation

### Constructor

```
var options = {
    excludedTables: /* tables to exclude from backup */,
    includedTables: /* only back up these tables */
    readPercentage: /* only consume this much capacity.  expressed as a decimal (i.e. .5 means use 50% of table read capacity).  default: .25 */,
    bucket:         /* bucket to upload the backup to */,
    stopOnFailure:  /* whether or not to continue backing up if a single table fails to back up */,
    saveDataPipelineFormat   /* save in format compatible with the AWS datapipeline import. Default to false (save as exported by DynamoDb) */,
    awsAccessKey:   /* AWS access key */,
    awsSecretKey:   /* AWS secret key */,
    awsRegion:   /* AWS region */,
    backupPath:     /* folder to save backups in.  default: 'DynamoDB-backup-YYYY-MM-DD-HH-mm-ss',
    base64Binary:   /* whether or not to base64 encode binary data before saving to JSON */
};

var backup = new DynamoBackup(options);
```

## Events

### error

Raised when there is an error backing up a table

__Example__
```
backup.on('error', function(data) {
    console.log('Error backing up ' + data.tableName);
    console.log(data.error);
});
```

### start-backup

Raised when the backup of a table is begining

__Example__
```
backup.on('start-backup', function(tableName) {
    console.log('Starting to copy table ' + tableName);
});
```

### end-backup

Raised when the backup of a table is finished

__Example__
```
backup.on('end-backup', function(tableName) {
    console.log('Done copying table ' + tableName);
});
```



## Functions

### backupAllTables

Backups all tables in the given region while respecting the `excludedTables` and `includedTables` options

__Arguments__

* `callback(err)` - callback which is called when all backups are complete, or an error occurs and `stopOnFailure` is true

### backupTable

Backups all tables in the given region while respecting the `excludedTables` and `includedTables` options

__Arguments__

* `tableName` - name of the table to backup
* `backupPath` - (optional) the path to use for the backup.
  The iterator is passed a `callback(err)` which must be called once it has 
  completed. If no error has occurred, the `callback` should be run without 
  arguments or with an explicit `null` argument.
* `callback(err)` - A callback which is called when the table has finished backing up, or an error occurs

# dynamo-restore-from-s3

![s3 to dynamo](https://raw.githubusercontent.com/sdesalas/dynamo-backup-to-s3/master/img/dynamo-restore-from-s3.png)

## Restore S3 backups back to Dynamo.

`dynamo-restore-from-s3` is a utility that restores backups in S3 back to dynamo. It streams data down from S3 and throttles the download speed to match the rate of batch writes to Dynamo. 

It is suitable for restoring large tables without needing to write to disk or use a large amount of memory. Use it on an AWS EC2 instance for best results and to minimise network latency, this should yield restore speeds of around 15min per GB.

Use `--overwrite` if the table already exists. Otherwise it will attempt to generate table on the fly.

Can be run as a command line script or as an npm module. 

# Command line usage

```
  Usage: dynamo-restore-from-s3 [options] -s "s3://mybucket/path/to/file.json" -t "new-dynamodb-table"

  Options:

    -h, --help                        output usage information
    -V, --version                     output the version number
    -s, --source [path]               Full S3 path to a JSON backup file (Required)
    -t, --table [name]                Name of the Dynamo Table to restore to (Required)
    -o, --overwrite                   Table already exists, skip auto-create. Default is false.
    -c, --concurrency <requestcount>  Number of concurrent requests & dynamo capacity units. Defaults to 200.
    -pk, --partitionkey [columnname]  Name of Primary Partition Key. If not provided will try determine from backup.
    -sk, --sortkey [columnname]       Name of Secondary Sort Key. Ignored unless --partitionkey is provided.
    -rc, --readcapacity <units>       Read Units for new table (when finished). Default is 5.
    -wc, --writecapacity <units>      Write Units for new table (when finished). Default is --concurrency.
    -sf, --stop-on-failure            Stop process when the same batch fails to restore multiple times. Defaults to false.
    --aws-key <key>                   AWS access key. Will use AWS_ACCESS_KEY_ID env var if --aws-key not set
    --aws-secret <secret>             AWS secret key. Will use AWS_SECRET_ACCESS_KEY env var if --aws-secret not set
    --aws-region <region>             AWS region. Will use AWS_DEFAULT_REGION env var if --aws-region not set
```

## Examples

```

    # Restore over existing table (cmd.exe).
    > node ./bin/dynamo-restore-from-s3 -t acme-customers -s s3://my-backups/acme-customers.json --overwrite 

    # Restore over existing table (shell).
    $ ./bin/dynamo-restore-from-s3 -t acme-customers -s s3://my-backups/acme-customers.json --overwrite 

    # Restore over existing table, 1000 concurrent requests. Stop if any batch fails 1000 times.
    $ ./bin/dynamo-restore-from-s3 -t acme-customers -c 1000 -s s3://my-backups/acme-customers.json --overwrite -sf

    # Restore over existing table, 1000 concurrent requests. When finished, set read capacity to 50 and write capacity to 10 (both needed).
    $ ./bin/dynamo-restore-from-s3 -t acme-customers -c 1000 -s s3://my-backups/acme-customers.json --overwrite --readcapacity 50 --writecapacity 10

    # Auto-generate table (determine PK from backup). 
    $ ./bin/dynamo-restore-from-s3 -t acme-customers -s s3://my-backups/acme-customers.json

    # Auto-generate table with partition and sort key.
    $ ./bin/dynamo-restore-from-s3 -t acme-orders -s s3://my-backups/acme-orders.json -pk customerId -sk createDate 

    # Auto-generate table, defined PK. Concurrency 2000 (~ 2GB backup).
    $ ./bin/dynamo-restore-from-s3 -t acme-orders -pk orderId -c 2000 -s s3://my-backups/acme-orders.json 

    # Auto-generate table. 2000 write units during restore. When finished set 50 write units and 100 write units (both needed).
    $ ./bin/dynamo-restore-from-s3 -t acme-orders -c 2000 -s s3://my-backups/acme-orders.json --readcapacity 100 --writecapacity 50

    # Auto-generate table. Concurrency 50 (10 MB backup or less).
    $ ./bin/dynamo-restore-from-s3 -t acme-orders -c 50 -s s3://my-backups/acme-orders.json 

    # Auto-generate table. Concurrency 50. Stop process if any batch fails 50 times.
    $ ./bin/dynamo-restore-from-s3 -t acme-orders -c 50 -sf -s s3://my-backups/acme-orders.json 

```

# npm module usage

## Quick Example

```
var DynamoRestore = require('dynamo-backup-to-s3').Restore;

var restore = new DynamoRestore({
    source: 's3://my-backups/DynamoDB-backup-2016-09-28-15-36-40/acme-customers-prod.json',
    table: 'acme-customers-dev',
    overwrite: true,
    concurrency: 200, // for large restores use 1 unit per MB as a rule of thumb (ie 1000 for 1GB restore)
    awsAccessKey: /* AWS access key */,
    awsSecretKey: /* AWS secret key */,
    awsRegion: /* AWS region */
});

restore.on('error', function(message) {
    console.log(message);
    process.exit(-1);
});

restore.on('warning', function(message) {
    console.log(message);
});

restore.on('send-batch', function(batches, requests, streamMeta) {
    console.log('Batch sent. %d in flight. %d Mb remaining to download...', requests, streamMeta.RemainingLength / (1024 * 1024));
});

restore.run(function() {
    console.log('Finished restoring DynamoDB table');
});

```

### Constructor

```
var options = {
    source: /* path to json file in s3 bucket, should start with s3://bucketname/... */,
    table: /* name of dynamo table, will be created on the fly unless overwritten */,
    overwrite: /* true/false if table already exits (defaults to false) */
    concurrency: /* number of concurrent requests (and dynamo write capacity units) */,
    partitionkey: /* name of partition key column */,
    sortkey: /* name of secondary (sort) key column */ ,
    readcapacity: /* number of read capacity units (when restore finishes) */,
    writecapacity: /* number of write capacity units (when restore finishes) */,
    stopOnFailure: /* true/false should a single failed batch stop the whole restore job? */,
    awsAccessKey: /* AWS access key */,
    awsSecretKey: /* AWS secret key */,
    awsRegion: /* AWS region */
};

var restore = new DynamoBackup.Restore(options);
```

## Events

### error

Raised when there is a fatal error restoring a table

__Example__
```
restore.on('error', function() {
    console.log('Error!! + ' + message);
});
```

### warning

Raised when there is a warning restoring a table. Normally this will be a failed batch.

__Example__
```
restore.on('warning', function() {
    console.log('Warning!! + ' + message);
});
```

### send-batch

Raised whenever a batch is sent to Dynamo. Useful for tracking progress.

__Example__
```
restore.on('send-batch', function(batches, requests, streamMeta) {
    console.log('Batch Sent');
    console.log('Num cached batches: ', batches); 
    console.log('Num requests in flight: ', requests);
    console.log('Stream metadata:, JSON.stringify(streamMeta));
});
```
### finish
Raised when the restore process is finished.

__Example__
```
restore.on('finish', function() {
    console.log('All done!');
});
```

## Functions

### run

Restores table with options as defined in constructor.

__Arguments__

* `callback(err)` - callback to execute when restore job is complete. First argument exists only if there is an error.

__Example__
```
restore.run(function(error) {
    if (error) {
        return console.log(error);
    }
    console.log('All done!');
});
```
