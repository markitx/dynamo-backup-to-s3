var _ = require('underscore');
var AWS = require('aws-sdk');
var moment = require('moment');
var path = require('path');
var async = require('async');

var Uploader = require('s3-streaming-upload').Uploader;

var DynamoBackup = require('./lib/dynamo-backup');

var runningAsScript = require.main === module;

if (runningAsScript) {
    var dynamoBackup = new DynamoBackup({ bucket: 'markitx-backups-test', stopOnFailure: true, readPercentage: .5, includedTables: ['development-asset-projects'] });
    dynamoBackup.on('error', function(data) {
        console.log('Error backing up ' + data.tableName);
        console.log(data.error);
        process.exit();
    });

    dynamoBackup.backupAllTables(function() {
        console.log('Finished backing up DynamoDB');
    });
} else {
    module.exports = DynamoBackup;
}

