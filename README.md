# Multi File Converter Mobile

React Native + Expo prototype for iOS and Android. The app supports batch file selection, conversion validation, a rewarded-ad gate for PDF inputs, progress display, retry, history, dark/light mode, English/Turkish text, and native share/export.

## Supported prototype conversions

- JPG -> PDF: implemented with `pdf-lib`
- TXT -> PDF: implemented with `pdf-lib`
- DOCX -> PDF: implemented by extracting DOCX text with `mammoth` and writing a PDF with `pdf-lib`
- XLSX -> CSV: implemented with `xlsx`
- CSV -> XLSX: implemented with `xlsx`
- MP3 -> WAV, WAV -> MP3, MP4 -> GIF, GIF -> MP4: implemented through `ffmpeg-kit-react-native`
- PDF -> JPG, PDF -> DOCX, PDF -> TXT: gated by the mock rewarded ad, then routed to a native-adapter placeholder

PDF rasterization and high-fidelity PDF/DOCX reverse conversion require production native modules or a server conversion engine. The app already includes the ad, retry, history, validation, and sharing workflow for those adapter points.

## Install

```powershell
npm install
```

Backend:

```powershell
cd backend
npm install
copy .env.example .env
npm start
```

FFmpeg and FFprobe must be installed and available in `PATH`, or configured in `backend/.env`.

## Run on a simulator or device

Start the Expo server:

```powershell
npm start
```

If the media backend runs on another host or port, set this before starting Expo:

```powershell
$env:EXPO_PUBLIC_MEDIA_API_URL="http://localhost:4000"
npm start
```

Rewarded ads default to the mock countdown so the prototype works in Expo Go and web:

```powershell
$env:EXPO_PUBLIC_USE_MOCK_ADS="true"
```

For a native development build with AdMob rewarded ads, set:

```powershell
$env:EXPO_PUBLIC_USE_MOCK_ADS="false"
$env:EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID="ca-app-pub-xxxxxxxxxxxxxxxx/yyyyyyyyyy"
npm run android
```

For pure JS conversions you can test most screens in Expo Go. For FFmpeg audio/video conversion, create a native development build:

```powershell
npm run android
npm run ios
```

The iOS command requires macOS with Xcode. Android requires Android Studio, an emulator or device, and USB debugging enabled for physical devices.

## Test checklist

1. Pick one or more files with the file selection button.
2. Select the matching input type and an output type.
3. Tap Convert.
4. For monetized operations, wait for the rewarded ad to finish before conversion starts.
5. Share a successful output from the conversion screen or history tab.
6. Try a wrong input extension to confirm validation errors.
7. Use Retry from an error or history item.
8. Toggle language and theme from the header.

## Production notes

- Rewarded ads are centralized in `src/services/rewardedAdService.ts` and `src/hooks/useRewardedAction.ts`.
- `react-native-google-mobile-ads` is configured in `app.json`; Expo Go uses the mock fallback.
- Replace the native-adapter placeholders in `src/services/conversionService.ts` for PDF rendering/extraction with a native PDF renderer or a secure server job.
- The backend media downloader accepts direct public media URLs, runs FFmpeg conversion jobs, exposes progress, and blocks private network URLs.
- Keep large-file conversion off the UI thread. For very large media files, prefer queued background jobs and stream-based conversion.
- Android permissions and iOS document sharing keys live in `app.json`.
