const DynamoBackup = require('./lib/dynamo-backup')
const DynamoRestore = require('./lib/dynamo-restore')

module.exports = {
  Backup: DynamoBackup,
  Restore: DynamoRestore
}
