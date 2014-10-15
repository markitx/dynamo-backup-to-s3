var _ = require('underscore');
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

function copyTable(tableName, itemsReceived, callback) {
    var ddb = new AWS.DynamoDB(tableName);

    function fetchItems(startKey, limit, itemsReceived, done) {
        var params = {
            Limit: limit,
            ReturnConsumedCapacity: 'NONE',
            TableName: tableName
        };
        if (startKey) {
            params.ExclusiveStartKey = startKey;
        }
        ddb.scan(params, function(err, data) {
            if (err) {
                console.log('Error fetching data');
                console.log(err);
                process.exit();
            }

            if( data.Items.length > 0) {
                itemsReceived(data.Items);
            }

            if (!data.LastEvaluatedKey || _.keys(data.LastEvaluatedKey).length === 0) {
                done();
            } else {
                fetchItems(data.LastEvaluatedKey, limit, itemsReceived, done);
            }
        });
    }

    ddb.describeTable({ TableName: tableName }, function(err, data) {
        if (err) {
            console.log('Error describing table');
            console.log(err);
            process.exit();
        }

        var limit = data.Table.ProvisionedThroughput.ReadCapacityUnits;

        fetchItems(null, limit, itemsReceived, callback);
    });
}

listTables(function(err, tables) {
    copyTable('member-plans', 
        function(items) {
            console.log(items)
        },
        function() {
            console.log('Done copying table');
        }
    );
});

