#!/bin/bash
set -e
REVISION_TAG="$1"
IMAGE_TAG=latest
PROJECT_ID=threeplabs
IMAGE_NAME=julesmomoa
EXTRA_DEPLOY_FLAGS=()

if [[ -z "$REVISION_TAG" ]]; then
  echo "Deploying to prod in 3 seconds... (Ctrl+C to cancel)"
  sleep 3
else
  IMAGE_TAG="$REVISION_TAG"
  EXTRA_DEPLOY_FLAGS=(--no-traffic --tag "$REVISION_TAG")
  echo "Deploying to revision \"$REVISION_TAG\""
fi

IMAGE=gcr.io/${PROJECT_ID}/${IMAGE_NAME}:${IMAGE_TAG}

gcloud \
  builds submit \
  --project $PROJECT_ID \
  --tag $IMAGE \
  .

echo "Deploying Cloud Run Job: momoa-code-runner"
# Try to update the job. If it fails (because it doesn't exist yet), create it.
gcloud run jobs update momoa-code-runner \
  --project $PROJECT_ID \
  --image $IMAGE \
  --region us-central1 \
  --command "node" \
  --args "dist/services/executionProviders/CloudRunJobsWorkers/cloudRunJobsWorker.js" \
  --max-retries 0 || \
gcloud run jobs create momoa-code-runner \
  --project $PROJECT_ID \
  --image $IMAGE \
  --region us-central1 \
  --command "node" \
  --args "dist/services/executionProviders/CloudRunJobsWorkers/cloudRunJobsWorker.js" \
  --max-retries 0 \
  --memory 4Gi