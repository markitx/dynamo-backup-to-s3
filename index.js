var DynamoBackup = require('./lib/dynamo-backup');
var DynamoRestore = require('./lib/dynamo-restore');

DynamoBackup.DynamoRestore = DynamoRestore;

module.exports = DynamoBackup;
