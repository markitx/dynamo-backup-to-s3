#!/bin/bash

./home/root/bin/dynamo-restore-from-s3 -t staging-accommodation-offers -c 1000 --index-concurrency 250 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-accommodation-offers.json --overwrite --readcapacity 15 --writecapacity 3 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-properties -c 800 --index-concurrency 75 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-properties.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-property-photos -c 800 --index-concurrency 75 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-property-photos.json --overwrite --readcapacity 50 --writecapacity 3 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-accounts -c 800 --index-concurrency 75 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-accounts.json --overwrite --readcapacity 10 --writecapacity 5 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-bookings -c 800 --index-concurrency 250 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-bookings.json --overwrite --readcapacity 15 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-enquire-availabilities -c 800 --index-concurrency 500 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-enquire-availabilities.json --overwrite --readcapacity 30 --writecapacity 3 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-prospective-bookings -c 800 --index-concurrency 250 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-prospective-bookings.json --overwrite --readcapacity 5 --writecapacity 3 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-guests -c 800 --index-concurrency 500 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-guests.json --overwrite --readcapacity 10 --writecapacity 5 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1

./home/root/bin/dynamo-restore-from-s3 -t staging-prospective-properties -c 500 --index-concurrency 75 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-prospective-properties.json --overwrite --readcapacity 10 --writecapacity 3 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-prospective-booking-events -c 500 --index-concurrency 75 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-prospective-booking-events.json --overwrite --readcapacity 15 --writecapacity 2 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-booking-events -c 500 --index-concurrency 75 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-booking-events.json --overwrite --readcapacity 5 --writecapacity 3 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-booking-summaries -c 500 --index-concurrency 75 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-booking-summaries.json --overwrite --readcapacity 10 --writecapacity 5 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-accommodation-providers -c 500 --index-concurrency 300 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-accommodation-providers.json --overwrite --readcapacity 10 --writecapacity 20 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1

./home/root/bin/dynamo-restore-from-s3 -t staging-agency-staffs -c 51 --index-concurrency 11 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-agency-staffs.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1

./home/root/bin/dynamo-restore-from-s3 -t staging-accommodation-provider-contacts -c 5 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-accommodation-provider-contacts.json --overwrite --readcapacity 4 --writecapacity 2 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1

./home/root/bin/dynamo-restore-from-s3 -t staging-accommodation-provider-push-notifications -c 50 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-accommodation-provider-push-notifications.json --overwrite --readcapacity 5 --writecapacity 5 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-accommodation-types -c 50 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-accommodation-types.json --partitionkey code --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-admin-staffs -c 5 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-admin-staffs.json --overwrite --readcapacity 5 --writecapacity 5  --index-concurrency 5 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-agencies -c 5 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-agencies.json --overwrite --readcapacity 1 --writecapacity 1 --partitionkey code --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-bank-details -c 100 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-bank-details.json --overwrite --readcapacity 5 --writecapacity 5 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-booking-complaints -c 100 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-booking-complaints.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-booking-fees -c 100 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-booking-fees.json --overwrite --readcapacity 10 --writecapacity 10 --partitionkey code --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-booking-impact-radius -c 100 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-booking-impact-radius.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-booking-notes -c 100 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-booking-notes.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-booking-reviews -c 50 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-booking-reviews.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-chatbot-chat -c 100 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-chatbot-chat.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-chatbot-intent-feedback -c 100 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-chatbot-intent-feedback.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-cities -c 100 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-cities.json --overwrite --readcapacity 10 --writecapacity 10 --partitionkey code --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-college-pages -c 100 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-college-pages.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-colleges -c 100 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-colleges.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-contact-messages -c 100 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-contact-messages.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-counters -c 15 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-counters.json --overwrite --readcapacity 10 --writecapacity 10 --partitionkey name --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-countries -c 15 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-countries.json --overwrite --readcapacity 10 --writecapacity 10 --partitionkey code --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-credits -c 100 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-credits.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-currencies -c 11 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-currencies.json --overwrite --readcapacity 10 --writecapacity 10 --partitionkey code --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-dynamic-pages -c 100 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-dynamic-pages.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-features -c 11 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-features.json --overwrite --readcapacity 10 --writecapacity 10 --partitionkey code --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-feeds -c 50 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-feeds.json --overwrite --readcapacity 10 --writecapacity 10 --partitionkey slug --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-fixed-contract-availabilities -c 100 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-fixed-contract-availabilities.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-invoice-details -c 100 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-invoice-details.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-languages -c 11 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-languages.json --overwrite --readcapacity 10 --writecapacity 10 --partitionkey code --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-locales -c 11 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-locales.json --overwrite --readcapacity 10 --writecapacity 10 --partitionkey code --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-neighborhood-pages -c 50 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-neighborhood-pages.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-neighborhoods -c 50 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-neighborhoods.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-oauth-access -c 50 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-oauth-access.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-oauth-client -c 11 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-oauth-client.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-oauth-refresh -c 11 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-oauth-refresh.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-offer-integration-enriched-jsons -c 200 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-offer-integration-enriched-jsons.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-partners -c 50 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-partners.json --overwrite --readcapacity 10 --writecapacity 10 --partitionkey code --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-payment-operations -c 400 --index-concurrency 400 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-payment-operations.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-promocodes -c 50 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-promocodes.json --overwrite --readcapacity 10 --writecapacity 10 --partitionkey code --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-property-rules -c 11 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-property-rules.json --overwrite --readcapacity 10 --writecapacity 10 --partitionkey code --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-property-types -c 11 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-property-types.json --overwrite --readcapacity 10 --writecapacity 10 --partitionkey code --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1

./home/root/bin/dynamo-restore-from-s3 -t staging-roles -c 11 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-roles.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-search-aggregates -c 100 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-search-aggregates.json --overwrite --readcapacity 10 --writecapacity 10 --partitionkey slug --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-standard-contract-availabilities -c 200 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-standard-contract-availabilities.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-standard-unitary-contract-availabilities -c 200 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-standard-unitary-contract-availabilities.json --overwrite --readcapacity 10 --writecapacity 10 --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-tag-types -c 11 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-tag-types.json --overwrite --readcapacity 10 --writecapacity 10 --partitionkey code --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-tags -c 11 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-tags.json --overwrite --readcapacity 10 --writecapacity 10 --partitionkey code --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
./home/root/bin/dynamo-restore-from-s3 -t staging-unit-types -c 11 -s s3://uniplaces.com.backups/$(date +%Y-%m-%d)/prod-unit-types.json --overwrite --readcapacity 10 --writecapacity 10 --partitionkey code --aws-key $AWS_KEY_RESTORE --aws-secret $AWS_SECRET_RESTORE --aws-region eu-west-1
