# SET YOUR AWS CONFIG BEFORE RUNNING
$(aws ecr get-login --region eu-west-1)
docker build -t dynamo-backup-to-s3 .
docker tag dynamo-backup-to-s3:latest 584629324139.dkr.ecr.eu-west-1.amazonaws.com/dynamo-backup-to-s3:latest
docker push 584629324139.dkr.ecr.eu-west-1.amazonaws.com/dynamo-backup-to-s3:latest

# more bash-friendly output for jq
JQ="jq --raw-output --exit-status"

# create task def
make_task_def() {
	task_def="[
		{
			\"name\": \"dynamo-backup-to-s3\",
			\"image\": \"584629324139.dkr.ecr.eu-west-1.amazonaws.com/dynamo-backup-to-s3:latest\",
			\"essential\": true,
			\"memory\": 2500,
			\"cpu\": 800,
            \"logConfiguration\": {
                \"logDriver\": \"awslogs\",
                \"options\": {
                    \"awslogs-group\": \"prod-jobs\",
                    \"awslogs-region\": \"eu-west-1\",
                    \"awslogs-stream-prefix\": \"dynamo-backup-job\"
                }
		    },
            \"environment\": [
                {
                    \"name\": \"AWS_KEY_BACKUP\",
                    \"value\":\"$AWS_KEY_BACKUP\"
                },
                {
                    \"name\": \"AWS_SECRET_BACKUP\",
                    \"value\": \"$AWS_SECRET_BACKUP\"
                },
                {
                    \"name\": \"AWS_KEY_RESTORE\",
                    \"value\": \"$AWS_KEY_RESTORE\"
                },
                {
                    \"name\": \"AWS_SECRET_RESTORE\",
                    \"value\": \"$AWS_SECRET_RESTORE\"
                },
                {
                    \"name\": \"SLACK_ID\",
                    \"value\": \"$SLACK_ID\"
                }
            ]
        }
	]"
}

# register definition
register_definition() {
    family="dynamo-backup-to-s3"
    if revision=$(aws ecs register-task-definition --container-definitions "$task_def" --family $family | $JQ '.taskDefinition.taskDefinitionArn'); then
        echo "Revision: $revision"
        echo "$revision" > arn_revision.txt
        echo $revision | sed -n -e 's/^.*task-definition\///p' > task_revision.txt
    else
        echo "Failed to register task definition"
        return 1
    fi
}

make_task_def
register_definition