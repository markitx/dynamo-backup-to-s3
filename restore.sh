#!/bin/bash

./home/root/bin/dynamo-restore-from-s3 -t staging-roles -c 200 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-roles.json --overwrite --index-concurrency 26 --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
