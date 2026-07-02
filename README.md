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
- `MAX_INPUT_MB`: per-file upload limit
- `MAX_FILES_PER_REQUEST`: maximum files accepted by multi-file upload endpoints
- `MAX_CONCURRENT_JOBS`: maximum simultaneous heavy conversion jobs
- `MAX_PENDING_JOBS`: maximum queued heavy conversion jobs before the backend returns a busy response
- `JOB_TTL_MINUTES`: generated-file and abandoned-upload retention window
- `TRUST_PROXY_HOPS`: trusted reverse proxy hop count; keep `0` unless the production host requires proxy headers
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
- Backend endpoints currently used by the app are `GET /health`, `POST /convert-file`, `POST /convert-images-to-pdf`, `POST /compress-pdf`, and `GET /files/:filename`.
- URL-based video download flows are intentionally not included; the app only converts files selected by the user.
- Keep large-file conversion off the UI thread. For very large media files, prefer queued background jobs and stream-based conversion.
- Android permissions and iOS document sharing keys live in `app.json`.

## App Store release checklist

- Build the public app with `EXPO_PUBLIC_INTERNAL_DIAGNOSTICS=false`.
- Build the public app with `EXPO_PUBLIC_MEDIA_API_URL` pointing to the deployed production backend, not a LAN IP or localhost.
- Keep the backend live during App Review; conversion, PDF rendering, PDF compression, and media conversion depend on it.
- Create a public privacy policy URL and support URL before submission. The in-app settings screen already includes privacy, terms, third-party notices, about, and open-source summaries.
- Complete App Store Connect privacy answers from the real production build: no advertising SDKs, no third-party tracking SDKs, selected files are processed only for requested conversion/editing flows.
- Set the app as paid in App Store Connect and complete paid app agreements, tax, and banking before release.
- Provide screenshots for required iPhone and iPad sizes, accurate metadata, and review notes explaining that users must select files they have rights to process.
- Do not ship development server URLs, simulator fixture UI, test auto-open flags, or internal diagnostics UI in the public build.
