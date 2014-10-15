var AWS = require('aws-sdk');

AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_DEFAULT_REGION || 'us-east-1'
});

var opts = {};
if (process.env.AWS_DYNAMODB_ENDPOINT){
    opts.endpoint = new AWS.Endpoint(process.env.AWS_DYNAMODB_ENDPOINT);
}

function listTables(callback) {
    var tables = [];
    var ddb = new AWS.DynamoDB();
    function fetchMoreTables(lastTable, done) {
        var params = {};
        if (lastTable) {
            params.ExclusiveStartTableName = lastTable;
        }
        ddb.listTables(params, function(err, data) {
            if (err) {
                console.log('Error listing tables');
                console.log(err);
                process.exit();
            }
            tables = tables.concat(data.TableNames);
            if (data.LastEvaluatedTableName) {
                fetchMoreTables(data.LastEvaluatedTableName, done);
            } else {
                done();
            }
        });
    }
    
    fetchMoreTables(null, function(err) {
        callback(null, tables);
    });
}

listTables(function(err, tables) {
    console.log(tables);
})