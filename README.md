# Editio

React Native + Expo mobile app for iOS, Android, and web. Editio supports batch file selection, conversion validation, PDF editing, signatures, text annotations, read-aloud, archive tools, progress display, retry, history/trash, dark/light mode, localization, and native share/export. Media-heavy conversions are handled by the Express backend with bundled FFmpeg/FFprobe.

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

For pure JS conversions you can test most screens in Expo Go. For native-module testing, create a development build:

```powershell
npm run android
npm run ios
```

The iOS command requires macOS with Xcode. Android requires Android Studio, an emulator or device, and USB debugging enabled for physical devices.

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
- Backend endpoints currently used by Editio are `GET /health`, `POST /convert-file`, `POST /convert-images-to-pdf`, `POST /compress-pdf`, `GET /files/:filename`, `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `DELETE /auth/account`, authenticated `GET/POST /conversion-history`, and the public rate-limited `POST /support/requests` website form.
- URL-based video download flows are intentionally not included; the app only converts files selected by the user.
- Keep large-file conversion off the UI thread. For very large media files, prefer queued background jobs and stream-based conversion.
- Android permissions and iOS document sharing keys live in `app.json`.

## App Store release checklist

- Build the public app with `EXPO_PUBLIC_INTERNAL_DIAGNOSTICS=false`.
- Build the public app with `EXPO_PUBLIC_MEDIA_API_URL` pointing to the deployed production backend, not a LAN IP or localhost.
- Keep the backend live during App Review; conversion, PDF rendering, PDF compression, and media conversion depend on it.
- Create a public privacy policy URL and support URL before submission. The in-app settings screen already includes privacy, terms, third-party notices, about, and open-source summaries.
- Complete App Store Connect privacy answers from the real production build: Name, Email Address, User ID, Other Data (date of birth), and signed-in conversion metadata (file name, formats, file size, status, and date) are linked to identity and used for App Functionality; no advertising or tracking is used. Converted file contents are processed only for requested workflows and are not stored in account history.
- Before enabling registration in production, deploy the July 15, 2026 privacy policy and terms at `https://www.editioapp.com`, mount and back up the account database volume, and update App Store Connect privacy answers.
- Set the app as paid in App Store Connect and complete paid app agreements, tax, and banking before release.
- Provide screenshots for required iPhone and iPad sizes, accurate metadata, and review notes explaining that users must select files they have rights to process.
- Do not ship development server URLs, simulator fixture UI, test auto-open flags, or internal diagnostics UI in the public build.
