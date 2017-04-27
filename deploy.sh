# SET YOUR AWS CONFIG BEFORE RUNNING
$(aws ecr get-login --region eu-west-1)
docker build -t dynamo-backup-to-s3 .
docker tag dynamo-backup-to-s3:latest 584629324139.dkr.ecr.eu-west-1.amazonaws.com/dynamo-backup-to-s3:latest
docker push 584629324139.dkr.ecr.eu-west-1.amazonaws.com/dynamo-backup-to-s3:latest
