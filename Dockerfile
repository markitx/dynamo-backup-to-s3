FROM node:8-alpine

RUN apk update && apk add jq curl

WORKDIR /home/node

COPY node_modules node_modules
COPY bin/dynamo-backup-to-s3 bin/dynamo-backup-to-s3
COPY index.js index.js
COPY lib lib
COPY package.json package.json

COPY backup.sh backup.sh
RUN chmod +x ./backup.sh

CMD ["./backup.sh"]