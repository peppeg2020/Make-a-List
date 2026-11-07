# Deployment checkpoint — automatic Google Drive renewal

## Verified

- Current published rollback: `311214d5ae48bff5a56b640a7dd3fa0fa20edc3d`.
- Separate rollback ZIP saved in the Make a List IOS Phone App workspace.
- Local frontend/backend tests pass; dependency audit reports zero known vulnerabilities.
- Project: `healthy-dragon-496703-b0`, existing OAuth client ending in `688ajtmn8.apps.googleusercontent.com`.
- Billing is now linked. Console showed both a free-trial banner and a paid-account
  label. Do not assume zero possible charges, and do not click Upgrade.
- User created Secret Manager secret `make-a-list-google-client-secret`, version 1 enabled.
- User confirmed backup account `180success@gmail.com` and approved runtime secret/database access and public callback.
- Google OAuth audience is External / Testing; Publish is disabled pending Branding.
- Branding currently has app name, support email, authorized domain and developer
  contact, but no homepage/privacy URLs. A factual privacy page is prepared locally.

## Still required before enabling the new frontend

1. User creates/saves the Google app secret. Do not put it in chat or source control.
2. Review/authorize the concrete runtime access and hosting settings below.
3. Run `prepare-google-cloud.sh --apply` in Google Cloud Shell, entering the secret
   at the hidden prompt; it is stored only in Secret Manager.
4. Run `deploy-google-cloud.sh --apply`, entering the actual Google account used for
   Drive backups. Do not assume the console login and iPhone backup account match.
5. Add the printed callback URI to the existing Google OAuth client. Keep old URIs.
6. Publish/review `privacy.html`; set Google branding homepage and privacy URL to
   the app's GitHub Pages URLs. Complete Google requirements to leave Testing.
7. Set the backend URL, then test a real Google connection. That consent step is
   completed by the account owner. Verify backup contents and renewal, not just health.
8. Publish frontend with backend endpoint only when available; verify live bytes.

## Concrete runtime plan

- Cloud Run `make-a-list-drive` in `us-central1`: min 0, max 1 instance; 256 MiB;
  request-based CPU billing; 1 CPU; concurrency 8; 30-second requests.
- Dedicated identity `make-a-list-drive@healthy-dragon-496703-b0.iam.gserviceaccount.com`.
- Firestore access for that identity; read access to only the two app-specific secrets.
- Public HTTP callback, but credentials required to retrieve access tokens/disconnect.
- No billing-account upgrade, subscription, reserved capacity, or minimum instances.
- Usage charges remain possible. A current Cloud Run spend-cap budget can pause
  Run requests but is not instant and does not cover Firestore/Secret Manager/builds.
  Do not represent it as a guaranteed total-dollar ceiling.
- Source deployment may require build identity permissions; inspect the actual
  permission error rather than granting broad Owner or Editor roles.
- Keep Firestore client rules closed. Use server IAM; do not enable Firebase client access.

The scripts default to a read-only plan. Preparation was started in Cloud Shell on November 6.
Required APIs and runtime identity were created; Firestore access was granted.
Deployment and live frontend activation are still pending.

## Rollback

Before publishing, preserve `311214d` as a rollback tag or branch. To roll back only
this feature, restore its `index.html` and republish (no reset of user list storage).
Disable the new Cloud Run service only after clients have moved back; deleting the
server session database is unnecessary and loses renewal connections.

## November 6 deployment progress

- Server deployed: `https://make-a-list-drive-c3qpahrqca-uc.a.run.app`.
- Runtime account and both Secret Manager grants applied; Firestore created. TTL updates submitted asynchronously.
- Server health 200; missing credential 401; foreign origin 403 verified.
- Privacy page published at commit `365e003` and live bytes verified. Google branding homepage/privacy saved.
- Callback URI submitted to existing OAuth client, retaining old URIs.
- User approval requested for switching Google OAuth from Testing to Production; pending.
- Frontend backup changes remain unpublished. Real owner consent, refresh, and backup checks still needed.

## Release checkpoint

- Google OAuth Production status confirmed after explicit user approval.
- Saved third callback URI verified from Google client settings.
- Frontend released as `88120f6`; live index and drive-connection.js match local files byte for byte.
- One-time owner connection on the phone is still needed. End-to-end owner consent, real Drive backup and refresh have not yet been verified.
