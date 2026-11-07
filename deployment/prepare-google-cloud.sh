#!/usr/bin/env bash
# Run in Google Cloud Shell after reviewing deployment/README.md.
set -euo pipefail
PROJECT_ID=healthy-dragon-496703-b0
REGION=us-central1
SERVICE=make-a-list-drive
RUNTIME_ACCOUNT="make-a-list-drive@${PROJECT_ID}.iam.gserviceaccount.com"
if [[ "${1:-}" != "--apply" ]]; then
  cat <<'PLAN'
Preparation only; no changes made. With --apply this script:
- Enables Cloud Run, Cloud Build, Artifact Registry, Firestore, and Secret Manager APIs.
- Creates the make-a-list-drive runtime identity and grants Firestore data access.
- Creates a default Firestore database if absent and enables expiry cleanup.
- Stores the OAuth secret you enter without displaying it or including it in source.
- Generates/stores a stable encryption key and grants access only to those two secrets.
It does NOT upgrade billing, create a subscription, or deploy the frontend.
Review the plan and Google Cloud account spending controls before running --apply.
PLAN
  exit 0
fi
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com secretmanager.googleapis.com --project="$PROJECT_ID"
if ! gcloud iam service-accounts describe "$RUNTIME_ACCOUNT" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create make-a-list-drive --display-name='Make a List Drive connection' --project="$PROJECT_ID"
fi
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$RUNTIME_ACCOUNT" --role=roles/datastore.user --condition=None --quiet >/dev/null
if ! gcloud firestore databases describe --database='(default)' --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud firestore databases create --database='(default)' --location="$REGION" --type=firestore-native --project="$PROJECT_ID"
fi
# No Firebase client SDK is used; access to the database is server IAM only.
for collection in drive_pending drive_sessions; do
  gcloud firestore fields ttls update expireAt --collection-group="$collection" --enable-ttl --async --project="$PROJECT_ID" --quiet
done
umask 077
secret_dir=$(mktemp -d)
trap 'rm -rf "$secret_dir"' EXIT
if ! gcloud secrets describe make-a-list-google-client-secret --project="$PROJECT_ID" >/dev/null 2>&1; then
  read -rsp 'Paste the newly saved Google client secret (hidden), then press Enter: ' oauth_secret
  printf '\n'
  printf '%s' "$oauth_secret" > "$secret_dir/oauth"
  unset oauth_secret
  gcloud secrets create make-a-list-google-client-secret --replication-policy=automatic --data-file="$secret_dir/oauth" --project="$PROJECT_ID" >/dev/null
fi
if ! gcloud secrets describe make-a-list-token-key --project="$PROJECT_ID" >/dev/null 2>&1; then
  openssl rand -base64 32 | tr -d '\n' > "$secret_dir/key"
  gcloud secrets create make-a-list-token-key --replication-policy=automatic --data-file="$secret_dir/key" --project="$PROJECT_ID" >/dev/null
fi
for secret_name in make-a-list-google-client-secret make-a-list-token-key; do
  gcloud secrets add-iam-policy-binding "$secret_name" --member="serviceAccount:$RUNTIME_ACCOUNT" --role=roles/secretmanager.secretAccessor --project="$PROJECT_ID" --quiet >/dev/null
done
printf 'Backend prerequisites prepared. No frontend release performed.\n'
