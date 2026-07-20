# Editio

React Native + Expo mobile app with an iPhone App Store target. The Android codebase remains available for development, but Apple subscription purchases are intentionally iOS-only. Editio supports batch file selection, conversion validation, PDF editing, signatures, text annotations, read-aloud, archive tools, progress display, retry, history/trash, dark/light mode, localization, and native share/export. Media-heavy conversions are handled by the Express backend with bundled FFmpeg/FFprobe.

## Supported conversions

- JPG/PNG -> PDF: implemented locally; multiple images are exported as one PDF
- TXT -> PDF: implemented locally with embedded Liberation Sans fonts for Turkish characters
- DOCX -> PDF: implemented by extracting DOCX text with `mammoth` and writing a PDF locally
- XLSX -> CSV: implemented with `xlsx`
- CSV -> XLSX: implemented with `xlsx`
- PDF -> JPG/PNG: implemented through the backend PDF renderer
- PDF -> UDF: implemented through the backend PDF text extractor
- PDF compression: implemented through the backend PDF optimizer/downsampler
- UDF -> PDF/TXT/RTF/DOC/DOCX/ODT: implemented locally with Turkish text handling, embedded PDF fonts, and image extraction/export support
- JPG/PNG/WEBP image conversion: implemented through the backend
- MP3 <-> WAV, video -> MP3, MP4/MOV -> GIF, GIF -> MP4: implemented through backend FFmpeg

Unsupported conversion pairs stay visible in the matrix only when they have a planned native/server implementation; the picker filters them out until implemented.

## Install

```powershell
npm install
```

Backend:

```powershell
cd backend
npm install
cp .env.example .env
npm run dev
```

The backend is an Express service running on Node.js. It uses `ffmpeg-static` and `ffprobe-static` by default. You can override paths with `FFMPEG_PATH` and `FFPROBE_PATH` in `backend/.env`.

Required backend environment variables:

- `PORT`: port provided by the host, for example `4000` in development
- `PUBLIC_BASE_URL`: public backend URL used for returned download links
- `ALLOWED_ORIGINS`: comma-separated browser origins when CORS is needed
- `DOWNLOAD_DIR`: output directory for generated files
- `DATABASE_PATH`: persistent SQLite account database path
- `MAX_INPUT_MB`: per-file upload limit
- `MAX_FILES_PER_REQUEST`: maximum files accepted by multi-file upload endpoints
- `MAX_CONCURRENT_JOBS`: maximum simultaneous heavy conversion jobs
- `MAX_PENDING_JOBS`: maximum queued heavy conversion jobs before the backend returns a busy response
- `JOB_TTL_MINUTES`: generated-file and abandoned-upload retention window
- `TRUST_PROXY_HOPS`: trusted reverse proxy hop count; keep `0` unless the production host requires proxy headers
- `AUTH_SESSION_DAYS`: account session duration, from 1 to 365 days
- `MIN_ACCOUNT_AGE`: minimum registration age, from 13 to 18
- `TERMS_VERSION` and `PRIVACY_VERSION`: accepted legal-document versions stored with new accounts
- `SUPPORT_TO_EMAIL`: recipient for website support requests
- `SUPPORT_MAX_ATTACHMENT_MB`: support attachment limit, from 1 to 25 MB
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`: SMTP delivery settings for `POST /support/requests`
- `FFMPEG_PATH` and `FFPROBE_PATH`: optional binary overrides
- `MONETIZATION_ENABLED`: coordinated backend subscription/quota feature flag
- `MONETIZATION_MIN_IOS_BUILD`: first iOS build containing the billing authorization protocol; set it before enabling monetization for a controlled rollout
- `FREE_CONVERSION_LIMIT`: lifetime successful conversion allowance, initially `3`
- `CONVERSION_AUTHORIZATION_TTL_MINUTES`: timeout for abandoned free-credit reservations
- `APPLE_BUNDLE_ID` and `APPLE_APP_ID`: verified Editio application identifiers
- `APPLE_MONTHLY_PRODUCT_ID` and `APPLE_YEARLY_PRODUCT_ID`: product allowlist
- `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_KEY_ID`, and `APPLE_IAP_PRIVATE_KEY_PATH`: App Store Server API credentials; the private key must stay outside Git
- `APPLE_IAP_ENVIRONMENT`: comma-separated Apple verification environments
- `APPLE_ROOT_CA_DIRECTORY`: repository-external directory of Apple DER root certificates
- `APPLE_NOTIFICATION_PRODUCTION_URL` and `APPLE_NOTIFICATION_SANDBOX_URL`: documented App Store Connect V2 destinations

Production backend startup:

```bash
cd backend
npm install --omit=dev
NODE_ENV=production \
PORT="$PORT" \
PUBLIC_BASE_URL="https://your-api-domain.example" \
ALLOWED_ORIGINS="https://your-web-origin.example" \
MAX_INPUT_MB=100 \
MAX_FILES_PER_REQUEST=10 \
MAX_CONCURRENT_JOBS=2 \
MAX_PENDING_JOBS=10 \
JOB_TTL_MINUTES=30 \
DATABASE_PATH="/var/lib/editio/editio.sqlite" \
AUTH_SESSION_DAYS=30 \
MIN_ACCOUNT_AGE=13 \
TERMS_VERSION=2026-07-15 \
PRIVACY_VERSION=2026-07-16 \
SUPPORT_TO_EMAIL="editioapp@gmail.com" \
SUPPORT_MAX_ATTACHMENT_MB=10 \
SMTP_HOST="smtp.gmail.com" \
SMTP_PORT=465 \
SMTP_SECURE=true \
SMTP_USER="editioapp@gmail.com" \
SMTP_PASS="$SMTP_PASS" \
SMTP_FROM="Editio Support <editioapp@gmail.com>" \
npm run start:prod
```

In production, `PUBLIC_BASE_URL` must be an HTTPS URL and must not point to localhost or a private LAN address. TLS should terminate at the hosting provider or reverse proxy; the Express app itself does not manage certificates.

Generated files and abandoned uploads are cleaned at startup and periodically while the backend is running. To inspect or clean existing local leftovers manually:

```bash
cd backend
npm run cleanup:dry
npm run cleanup
```

Production syntax/build check:

```bash
cd backend
npm run build
```

Production-like Docker build and verification:

```bash
cd backend
docker build --platform linux/amd64 -t editio-backend:local .
```

Create a local Docker env file when testing the image. Do not commit this file:

```bash
cat > .env.docker <<'EOF'
NODE_ENV=production
PORT=4000
PUBLIC_BASE_URL=https://api.example.com
ALLOWED_ORIGINS=
DOWNLOAD_DIR=/app/data/downloads
DATABASE_PATH=/app/data/editio.sqlite
MAX_INPUT_MB=100
MAX_FILES_PER_REQUEST=10
MAX_CONCURRENT_JOBS=2
MAX_PENDING_JOBS=10
JOB_TTL_MINUTES=30
TRUST_PROXY_HOPS=0
AUTH_SESSION_DAYS=30
MIN_ACCOUNT_AGE=13
TERMS_VERSION=2026-07-15
PRIVACY_VERSION=2026-07-16
SUPPORT_TO_EMAIL=editioapp@gmail.com
SUPPORT_MAX_ATTACHMENT_MB=10
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=editioapp@gmail.com
SMTP_PASS=
SMTP_FROM=Editio Support <editioapp@gmail.com>
FFMPEG_PATH=
FFPROBE_PATH=
MONETIZATION_ENABLED=false
FREE_CONVERSION_LIMIT=3
CONVERSION_AUTHORIZATION_TTL_MINUTES=15
APPLE_BUNDLE_ID=com.cantecim.editio
APPLE_APP_ID=6790405876
APPLE_MONTHLY_PRODUCT_ID=com.cantecim.editio.pro.monthly
APPLE_YEARLY_PRODUCT_ID=com.cantecim.editio.pro.yearly
APPLE_IAP_ISSUER_ID=
APPLE_IAP_KEY_ID=
APPLE_IAP_PRIVATE_KEY_PATH=
APPLE_IAP_ENVIRONMENT=Sandbox,Production
APPLE_ROOT_CA_DIRECTORY=
APPLE_NOTIFICATION_PRODUCTION_URL=https://api.editioapp.com/billing/apple/notifications
APPLE_NOTIFICATION_SANDBOX_URL=https://api.editioapp.com/billing/apple/notifications
EOF
```

Run the container with production mode and bounded resources:

```bash
docker run --rm \
  --platform linux/amd64 \
  --cpus=2 \
  --memory=4g \
  --name editio-backend-test \
  --mount source=editio-data,target=/app/data \
  -p 4000:4000 \
  --env-file .env.docker \
  editio-backend:local
```

The Docker image stores temporary uploads and generated outputs under `/app/data/downloads` and account records under `/app/data/editio.sqlite`. A persistent `/app/data` volume is required once account creation is enabled. Documents remain temporary and continue to be removed by the cleanup service; back up the SQLite database according to the server's recovery policy.

With the container running, verify native Linux dependencies and endpoints:

```bash
DOCKER_CONTAINER=editio-backend-test DOCKER_VERIFY_BASE_URL=http://127.0.0.1:4000 npm run docker:verify
```

The runtime image is Debian/glibc based, runs as the non-root `node` user, includes `tini` for signal forwarding, and health-checks `GET /health` inside the container.

## Run on a simulator or device

Start the Expo server:

```powershell
npm start
```

If the media backend runs on another host or port, set this before starting Expo:

```powershell
$env:EXPO_PUBLIC_MEDIA_API_URL="http://YOUR_COMPUTER_LAN_IP:4000"
npm start
```

For production mobile builds, set `EXPO_PUBLIC_MEDIA_API_URL` to the deployed backend URL before building the app. In native development builds, if this URL points to `localhost`, the app rewrites it to the current Metro host and keeps `EXPO_PUBLIC_MEDIA_API_PORT`.

Apple monetization is controlled centrally by:

```dotenv
EXPO_PUBLIC_MONETIZATION_ENABLED=false
EXPO_PUBLIC_EDITIO_MONTHLY_PRODUCT_ID=com.cantecim.editio.pro.monthly
EXPO_PUBLIC_EDITIO_YEARLY_PRODUCT_ID=com.cantecim.editio.pro.yearly
```

Keep the mobile and backend monetization flags `false` until the App Store Connect products, Apple server credentials, Server Notifications V2 and Sandbox tests are complete. When disabled, the existing unrestricted conversion behavior is preserved. When enabled on iOS, the backend grants a lifetime allowance of three completed conversion jobs and then requires a verified Editio Pro entitlement. Failed and cancelled jobs release their reservation. Android does not expose Apple purchase controls or enforce this iOS paywall.

For pure JS conversions you can test most screens in Expo Go. For native-module testing, create a development build:

```powershell
npm run android
npm run ios
```

The iOS command requires macOS with Xcode. Android requires Android Studio, an emulator or device, and USB debugging enabled for physical devices.

`expo-iap` does not run in Expo Go. Subscription development requires a native development build. The shared iOS scheme uses `ios/FileConverter/Supporting/Editio.storekit` for local StoreKit fixtures. These fixtures do not create App Store Connect products or prove real Sandbox purchases. See:

- `docs/app-store-subscription-setup.md`
- `docs/apple-subscription-manual-tests.md`
- `docs/app-store-metadata-subscriptions.md`
- `docs/subscription-rollout-runbook.md`

The static website defaults to pre-launch subscription copy. Build it with an explicit rollout flag:

```bash
MONETIZATION_LIVE=false node website/scripts/build.mjs
```

Use `MONETIZATION_LIVE=true` only after Editio Pro is actually available for purchase and the coordinated mobile/backend rollout has passed. The generated value is written into `website/dist/assets/js/config.js`; it is not a runtime secret.

## Subscription architecture

- Mobile StoreKit 2 integration: `expo-iap`
- Server verification and Notifications V2: Apple’s official `@apple/app-store-server-library`
- Anonymous identity: random UUID stored with `expo-secure-store`; no IDFA or device fingerprinting
- Signed-in identity: stable random backend `appAccountToken`
- Source of truth: backend `subscription_entitlements`, never a client `isPremium` flag
- Quota: atomic SQLite reservation/complete/release records in `conversion_usage_events`
- Restore: StoreKit active purchases are sent to the backend for verification
- Management: Apple’s subscription management screen; Editio does not implement a fake cancellation button
- Account deletion: profile/history are deleted and billing association is anonymized; Apple subscription cancellation remains an Apple action

Billing API routes:

- `GET /billing/config`
- `GET /billing/entitlement`
- `POST /billing/apple/transactions/verify`
- `POST /billing/apple/notifications`
- `POST /billing/conversion-authorizations`
- `POST /billing/conversion-authorizations/:id/complete`
- `POST /billing/conversion-authorizations/:id/release`

The notification endpoint is public and separately rate-limited. Its trust boundary is Apple’s verified signed JWS, not an Editio auth token. Signed payloads, private keys, auth tokens and document contents must not be logged.

## Test checklist

1. Pick one or more files with the file selection button.
2. Select the matching input type and an output type.
3. Tap Convert.
4. Share a successful output from the conversion screen or history tab.
5. Try a wrong input extension to confirm validation errors.
6. Use Retry from an error or history item.
7. Toggle language and theme from the header.

## Production notes

- PDF rendering/extraction, still-image re-encoding, and FFmpeg audio/video conversion are routed to `backend/src/services/uploadConvertService.js`.
- Backend endpoints currently used by Editio are `GET /health`, `POST /convert-file`, `POST /convert-images-to-pdf`, `POST /compress-pdf`, `GET /files/:filename`, `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `DELETE /auth/account`, authenticated `GET/POST /conversion-history`, billing routes listed above, and the public rate-limited `POST /support/requests` website form.
- URL-based video download flows are intentionally not included; the app only converts files selected by the user.
- Keep large-file conversion off the UI thread. For very large media files, prefer queued background jobs and stream-based conversion.
- Android permissions and iOS document sharing keys live in `app.json`.

## App Store release checklist

- Build the public app with `EXPO_PUBLIC_INTERNAL_DIAGNOSTICS=false`.
- Build the public app with `EXPO_PUBLIC_MEDIA_API_URL` pointing to the deployed production backend, not a LAN IP or localhost.
- Keep `EXPO_PUBLIC_MONETIZATION_ENABLED` and backend `MONETIZATION_ENABLED` aligned. Enable them only after products, Apple credentials, Notifications V2 and physical-device Sandbox tests pass.
- Keep the backend live during App Review; conversion, PDF rendering, PDF compression, and media conversion depend on it.
- Create a public privacy policy URL and support URL before submission. The in-app settings screen already includes privacy, terms, third-party notices, about, and open-source summaries.
- Complete App Store Connect privacy answers from the real production build: Name, Email Address, User ID, Other Data (date of birth), and signed-in conversion metadata (file name, formats, file size, status, and date) are linked to identity and used for App Functionality; no advertising or tracking is used. Converted file contents are processed only for requested workflows and are not stored in account history.
- Before enabling registration in production, deploy the July 15, 2026 privacy policy and terms at `https://www.editioapp.com`, mount and back up the account database volume, and update App Store Connect privacy answers.
- Keep the app download free and configure Editio Pro as auto-renewable in-app subscriptions. Complete the Paid Apps Agreement, tax and banking information before release.
- Add the first monthly/yearly subscription products to the submitted app version and provide subscription review screenshots and review notes.
- The native target is iPhone-only (`supportsTablet: false`, `TARGETED_DEVICE_FAMILY = 1`). Do not add an iPad-specific target or iPad orientation while preparing IAP.
- Provide required iPhone screenshots, accurate metadata, and review notes explaining that users must select files they have rights to process.
- Do not ship development server URLs, simulator fixture UI, test auto-open flags, or internal diagnostics UI in the public build.
- Back up the persistent SQLite volume before deploying the billing migration. Never bake `/app/data/editio.sqlite` or the Apple `.p8` key into the image.
