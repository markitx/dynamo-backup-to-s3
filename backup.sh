#!/bin/sh
set -e

CREDENTIALS=$(curl --max-time 10 "http://169.254.170.2$AWS_CONTAINER_CREDENTIALS_RELATIVE_URI")
ACCESSKEY=$(echo ${CREDENTIALS} | jq -r '.AccessKeyId')
SECRETKEY=$(echo ${CREDENTIALS} | jq -r '.SecretAccessKey')
SESSIONTOKEN=$(echo ${CREDENTIALS} | jq -r '.Token')

exec env AWS_ACCESS_KEY_ID=${ACCESSKEY} AWS_SECRET_ACCESS_KEY=${SECRETKEY} AWS_SESSION_TOKEN=${SESSIONTOKEN} \
    ./bin/dynamo-backup-to-s3 --aws-region eu-west-1 -b attest-dynamo-backups
