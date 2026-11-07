#!/usr/bin/env bash
set -euo pipefail
PROJECT_ID=healthy-dragon-496703-b0
REGION=us-central1
SERVICE=make-a-list-drive
RUNTIME_ACCOUNT="make-a-list-drive@${PROJECT_ID}.iam.gserviceaccount.com"
if [[ "${1:-}" != "--apply" ]]; then
  cat <<'PLAN'
No changes made. With --apply this script deploys the reviewed backend:
- Cloud Run: zero minimum instances, one maximum instance, request-based CPU billing.
- 256 MiB memory, 1 CPU, 8 concurrent requests, 30-second request timeout.
- Public OAuth callback; token routes still require a random device credential.
- Secrets are mounted from Secret Manager, not embedded in the deployment or app.
- Owner's Google account must be entered explicitly.
No frontend publication or Google billing upgrade is performed by this script.
PLAN
  exit 0
fi
read -rp 'Google account email used for this app’s Drive backups: ' drive_account
if [[ ! "$drive_account" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  printf 'Enter a valid Google account email.\n' >&2; exit 1
fi
repo_dir=$(cd "$(dirname "$0")/.." && pwd)
existing_url=$(gcloud run services describe "$SERVICE" --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)' 2>/dev/null || true)
gcloud run deploy "$SERVICE" --source="$repo_dir/backup-server" \
  --project="$PROJECT_ID" --region="$REGION" --service-account="$RUNTIME_ACCOUNT" \
  --min-instances=0 --max-instances=1 --concurrency=8 --memory=256Mi --cpu=1 --cpu-throttling --timeout=30 \
  --allow-unauthenticated \
  --set-env-vars="APP_ORIGIN=https://peppeg2020.github.io,PUBLIC_URL=${existing_url:-https://pending.invalid},GOOGLE_CLIENT_ID=801517587590-qjea3b1ji3kjbm0toc69cgi688ajtmn8.apps.googleusercontent.com,ALLOWED_EMAIL=$drive_account" \
  --set-secrets='GOOGLE_CLIENT_SECRET=make-a-list-google-client-secret:latest,TOKEN_KEY=make-a-list-token-key:latest'
service_url=$(gcloud run services describe "$SERVICE" --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)')
gcloud run services update "$SERVICE" --region="$REGION" --project="$PROJECT_ID" --update-env-vars="PUBLIC_URL=$service_url" --quiet
# Do not retain authorization codes in Cloud Run request logs.
gcloud logging sinks update _Default --project="$PROJECT_ID" \
  --add-exclusion="name=make-a-list-oauth-callback,description=Exclude authorization callback request URLs,filter=resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"make-a-list-drive\" AND httpRequest.requestUrl:\"/oauth/callback\""
printf '\nRegister this authorized Google redirect URI before connecting:\n%s/oauth/callback\n' "$service_url"
printf '\nThen set MAKE_A_LIST_DRIVE_BACKEND in drive-connection.js to:\n%s\n' "$service_url"
curl --fail --silent --show-error "$service_url/health"
printf '\nNo frontend release was performed. Verify callback configuration and account authorization before release.\n'
