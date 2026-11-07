# Make a List automatic Google Drive connection

Status: implemented locally, not deployed or enabled. The existing browser-only
connection remains active until `MAKE_A_LIST_DRIVE_BACKEND` in
`../drive-connection.js` is set to a verified HTTPS service URL.

The app stays at https://peppeg2020.github.io/Make-a-List/.
Google refresh tokens stay encrypted in server-side Firestore. This service returns
only short-lived access tokens to the specific connected device; the app uploads
lists and photos directly to Drive. It does not store list contents on the server.
This is not a background-upload daemon: unsent device changes retry while the app
is open, on returning to the app, and when connectivity returns. An iPhone can
suspend a web app; nothing here guarantees uploads after it has been closed.

## Deployment prerequisites

Project found in Google Cloud: `healthy-dragon-496703-b0` (Make a List).
The owner has linked billing. The console showed both a trial-credit banner and
a paid-account label; do not assume hosting cannot generate charges. See
`../deployment/README.md` for the current deployment checkpoint. No billing changes,
Google credential changes, or IAM changes have been made by this implementation.

Use Cloud Run (Node 22 or newer), Firestore Native mode, and Secret Manager.
Use a dedicated runtime service account with only Firestore access and access to
the two named secrets below. Do not use a service-account key file. Configure
Firestore rules to deny browser/client reads and writes. Server IAM is independent
of those rules. Set Cloud Run minimum instances to 0 and maximum instances to 1
initially; billing budgets alert but do not enforce a hard spending cap.

Required configuration:

- `APP_ORIGIN=https://peppeg2020.github.io`
- `PUBLIC_URL=<actual Cloud Run HTTPS origin, no trailing slash>`
- `GOOGLE_CLIENT_ID=801517587590-qjea3b1ji3kjbm0toc69cgi688ajtmn8.apps.googleusercontent.com`
- `ALLOWED_EMAIL=<owner's Google Drive account>`; only this verified account may connect.
- `GOOGLE_CLIENT_SECRET`: bind from Secret Manager, never commit it or put it in HTML.
- `TOKEN_KEY`: bind from Secret Manager, 32 random bytes encoded as base64.
  Keep this key stable across deployments; changing it invalidates existing encrypted sessions.
- `FIRESTORE_DATABASE`: optional, defaults to `(default)`.

Use the **existing OAuth client** to retain access to backups created through its
`drive.file` grant. Add `<PUBLIC_URL>/oauth/callback` to that client's authorized
redirect URIs, keeping its existing origins and callbacks. If the old client secret
is unavailable, the owner must create/store one securely without removing the old
working client. Do not paste secrets into chat.

Check Google Auth Platform → Audience. For external apps left in Testing,
refresh tokens with Drive scopes can expire after 7 days. Configure an appropriate
Production consent setup and complete any Google requirements before calling the
connection long-lived. Reconnection is still needed if access is revoked or Google
expires the grant.

## Build and deploy

Run `npm ci` and `npm test` in this directory. Google Cloud can deploy this directory
using its Node buildpack (`npm start`). Use `gcloud run deploy make-a-list-drive
--source backup-server ...` from the repository root after the owner approves the
hosting/billing and runtime permissions. Configure Secret Manager bindings rather
than passing secret values in command history.

The service needs public HTTP reachability for the OAuth callback and app requests,
but `/token` and `/disconnect` require an unguessable device credential. `/connect`
is origin-checked and rate limited. Only the owner's verified Google identity can
create a session. If a first deployment is needed to discover the service URL, use
`PUBLIC_URL=https://pending.invalid`, then immediately update to the actual URL and
register the callback before connecting any device.

Enable Firestore TTL on `expireAt` for the `drive_pending` and `drive_sessions`
collection groups. The code independently rejects expired records; TTL removes
expired records in the background. Session inactivity expiry is 180 days and is
extended on successful use. Pending sign-ins expire after 10 minutes. Logging must
not include Authorization headers, request bodies, callback query strings, OAuth
responses, or secrets. Configure Cloud Logging exclusions/redaction for callback
request URLs containing authorization codes; codes are short-lived and single-use
but should not be retained in access logs.

## Activation checklist

1. Verify `/health` returns `{ "ok": true }`.
2. Set the backend URL in `drive-connection.js` locally.
3. Test on the deployed app origin: sign in once; confirm existing backups are found.
4. Verify expiry renewal, app reopen, offline edit/reconnect, revoked access, and
   disconnect on the actual iPhone. Test large photo backups.
5. Verify a failed or partially completed backup never clears the pending marker.
6. Publish the frontend only after the backend is available and configured.
7. Keep the old connection code available during rollout; blank the backend URL to
   roll back. Old access tokens cannot be upgraded without one new consent flow.

## Security and architecture

OAuth uses Google's official library, PKCE, a single-use state and an ID-token nonce.
The server verifies ID-token audience, verified owner email, and Drive permission.
Callback delivery uses `postMessage` to the exact app origin; the app checks origin,
window identity, and state before saving its device credential. No third-party
cookies or main-app redirects are needed. The device credential is random, hashed
in Firestore and sent only in an Authorization header. Refresh credentials are
AES-256-GCM encrypted using a Secret Manager key. Disconnect removes the device's
server session without revoking other devices' Google grants.

A device credential is sensitive: like current local lists, it is accessible to
scripts running at the app's origin. Avoid untrusted scripts and keep the device
secure. This broker deliberately exposes short-lived Google access tokens to the
existing client so the existing direct-to-Drive implementation can stay in place.

Tests use fake Google responses and a memory store, not the user's account.
Live Google authorization, Cloud Run IAM, Firestore rules, and iPhone popup behavior
remain deployment verification steps, not claims made by unit tests.

Official references:
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/identity/protocols/oauth2
- https://cloud.google.com/run/docs/deploying-source-code
