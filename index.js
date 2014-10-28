var _ = require('underscore');
var AWS = require('aws-sdk');
var moment = require('moment');

var DynamoBackup = require('./lib/dynamo-backup');

var runningAsScript = require.main === module;

if (runningAsScript) {
    var runTimes = {};

    var dynamoBackup = new DynamoBackup({ bucket: 'markitx-backups-test', stopOnFailure: true, readPercentage: .5 });
    dynamoBackup.on('error', function(data) {
        console.log('Error backing up ' + data.tableName);
        console.log(data.error);
        process.exit();
    });
    dynamoBackup.on('start-backup', function(tableName) {
        runTimes[tableName] = moment();
        console.log('Starting to copy table ' + tableName);
    });
    dynamoBackup.on('end-backup', function(tableName) {
        var endTime = moment();
        var startTime = runTimes[tableName];
        console.log('Done copying table ' + tableName + '. Took ' + endTime.diff(startTime, 'minutes', true).toFixed(2) + ' minutes');
    });

    dynamoBackup.backupAllTables(function() {
        console.log('Finished backing up DynamoDB');
    });
} else {
    module.exports = DynamoBackup;
}

