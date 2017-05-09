#!/bin/bash

./home/root/bin/dynamo-backup-to-s3 --bucket uniplaces.com.backups -p $(date +%Y-%m-%d) -r 0.5 --aws-key $AWS_KEY_BACKUP --aws-secret $AWS_SECRET_BACKUP --aws-region eu-west-1 --excluded-tables prod-search-offers,prod-admin-session,prod-ap-session,prod-core-session,prod-ops-session,prod-photography-session,prod-spa-session