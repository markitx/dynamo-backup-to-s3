# dynamo-backup-to-s3

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
    -f, --save-schema                save table schema. Default to false
    --aws-key                        AWS access key. Will use AWS_ACCESS_KEY_ID env var if --aws-key not set
    --aws-secret                     AWS secret key. Will use AWS_SECRET_ACCESS_KEY env var if --aws-secret not set
    --aws-region                     AWS region. Will use AWS_DEFAULT_REGION env var if --aws-region not set
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
    saveSchema: true,
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
    saveSchema:     /* save table schema */,
    awsAccessKey:   /* AWS access key */,
    awsSecretKey:   /* AWS secret key */,
    awsRegion:      /* AWS region */,
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
