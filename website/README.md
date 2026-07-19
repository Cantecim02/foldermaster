# Editio product website

Editio's public product and legal website is a dependency-free static site. It is designed for Caddy `file_server` hosting and does not require a permanent Node.js website process.

## Routes

- `/`
- `/privacy/`
- `/terms/`
- `/support/`

Folder-based `index.html` files preserve the existing production legal URLs. No Caddy configuration change is required for the current `file_server` setup.

## Local preview

Build and validate the static output:

```bash
node website/scripts/build.mjs
```

Serve the generated output:

```bash
python3 -m http.server 4173 --directory website/dist
```

Open `http://127.0.0.1:4173`.

## Production output

There is no framework compilation or dependency installation. The production build command is:

```bash
node website/scripts/build.mjs
```

The complete static output is generated at:

```text
website/dist/
```

## Editable configuration

- App Store URL: `website/assets/js/config.js` → `appStoreUrl`
- Backend API URL: `website/assets/js/config.js` → `apiBaseUrl`
- Support email: `website/assets/js/config.js` → `supportEmail`
- Turkish and English copy: `website/assets/js/translations.js`
- Main styling and design tokens: `website/assets/css/site.css`
- Real iOS app screenshots:
  - `website/assets/images/editio-screen-convert.png`
  - `website/assets/images/editio-screen-archive.png`
  - `website/assets/images/editio-screen-settings.png`

When the App Store listing is public, set its full HTTPS URL in `appStoreUrl`. Until then, all store CTAs intentionally display “Coming Soon” and do not point to a fake listing.

The hero carousel uses high-resolution iOS Simulator captures of the current Editio application. Replace these three files with approved App Store screenshots when the final release UI is ready, keeping their filenames or updating the references in `website/index.html`.

## Support form

The support panel sends `multipart/form-data` directly to `POST /support/requests` at the configured API base URL. Local website previews use `http://127.0.0.1:4000`; production uses `https://api.editioapp.com`.

The production backend must include both website origins in `ALLOWED_ORIGINS`:

```text
https://editioapp.com,https://www.editioapp.com
```

SMTP credentials belong only in the backend production environment. They must never be added to this static website or committed to the repository.

## Safe VPS upload

Deployment is intentionally not automated by this repository. Review `website/dist/` locally before uploading. The current production directory is `/var/www/editio`.

Create a local build, upload it to a temporary server directory, back up the current site, and then synchronize:

```bash
node website/scripts/build.mjs
rsync -av --delete website/dist/ editio-vps:/tmp/editio-site/
ssh editio-vps 'sudo mkdir -p /var/www/editio-backups && sudo tar -czf /var/www/editio-backups/editio-site-$(date +%Y%m%d-%H%M%S).tar.gz -C /var/www editio'
ssh editio-vps 'sudo rsync -av --delete /tmp/editio-site/ /var/www/editio/'
```

Then verify without changing Caddy:

```bash
curl -I https://editioapp.com/
curl -I https://editioapp.com/privacy/
curl -I https://editioapp.com/terms/
curl -I https://editioapp.com/support/
```

Do not upload source-only files such as `website/scripts/` or this README. The build script excludes them from `website/dist/`.
