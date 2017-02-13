var DynamoBackup = require('./lib/dynamo-backup');
var DynamoRestore = require('./lib/dynamo-restore');

DynamoBackup.Restore = DynamoRestore;

module.exports = DynamoBackup;
