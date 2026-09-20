#!/bin/bash
set -e

REGION=ap-southeast-1
ACCOUNT=000000000000

echo "== creating S3 buckets =="
awslocal s3 mb s3://crawler-html --region $REGION
awslocal s3 mb s3://crawler-text --region $REGION

echo "== creating DLQs =="
awslocal sqs create-queue --queue-name frontier-dlq --region $REGION
awslocal sqs create-queue --queue-name parsing-dlq  --region $REGION

FRONTIER_DLQ_ARN="arn:aws:sqs:${REGION}:${ACCOUNT}:frontier-dlq"
PARSING_DLQ_ARN="arn:aws:sqs:${REGION}:${ACCOUNT}:parsing-dlq"

echo "== creating main queues =="
# VisibilityTimeout 60s: if a crawler dies, the URL comes back after 60s.
# maxReceiveCount 5: after 5 failed tries the message goes to the DLQ.
awslocal sqs create-queue --queue-name frontier-queue --region $REGION \
  --attributes "{
    \"VisibilityTimeout\":\"60\",
    \"MessageRetentionPeriod\":\"1209600\",
    \"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"${FRONTIER_DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\"
  }"

awslocal sqs create-queue --queue-name parsing-queue --region $REGION \
  --attributes "{
    \"VisibilityTimeout\":\"120\",
    \"MessageRetentionPeriod\":\"1209600\",
    \"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"${PARSING_DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\"
  }"

echo "== done =="
