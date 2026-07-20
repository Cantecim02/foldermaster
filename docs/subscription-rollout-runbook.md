# Editio subscription rollout and rollback

This runbook is operational documentation only. Do not enable monetization until App Store Connect products, Apple credentials, Notifications V2, Sandbox purchases, and the physical-device test matrix have all passed.

## Safe rollout order

1. Keep the website build at `MONETIZATION_LIVE=false`.
2. Keep backend `MONETIZATION_ENABLED=false` and mobile `EXPO_PUBLIC_MONETIZATION_ENABLED=false` while validating the migration and Apple configuration.
3. Set `MONETIZATION_MIN_IOS_BUILD` to the first TestFlight/App Store build that contains the billing authorization protocol.
4. Release the compatible mobile build with `EXPO_PUBLIC_MONETIZATION_ENABLED=true` while the backend flag remains false. The effective client flag remains false and no paywall is shown.
5. After Sandbox purchase, restore, refund/revoke notification, quota, and conversion smoke tests pass, set backend `MONETIZATION_ENABLED=true` and recreate the container.
6. Build and publish the website with `MONETIZATION_LIVE=true` only after subscriptions are actually available for purchase.

| Mobile | Backend | Expected behavior |
| --- | --- | --- |
| false | false | Existing unrestricted conversion flow |
| true | false | Existing flow; no paywall or quota lock |
| false | true | Old clients receive update-required before upload; billing-aware clients without authorization receive authorization-required |
| true | true | Verified entitlement and atomic free-quota flow |

## Pre-deploy inspection and backup

Run on the VPS from `/home/ubuntu/editio-backend`. These commands do not print the environment file.

```bash
cd /home/ubuntu/editio-backend
docker inspect --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}' editio-backend
docker inspect --format '{{.Config.Image}}' editio-backend
```

Confirm that the persistent host directory is mounted to `/app/data` and that the database resolves to `/app/data/editio.sqlite` inside the container.

Create an immutable image rollback tag and an online SQLite backup:

```bash
cd /home/ubuntu/editio-backend
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p data/backups
CURRENT_IMAGE_ID="$(docker inspect --format '{{.Image}}' editio-backend)"
docker tag "$CURRENT_IMAGE_ID" "editio-backend:rollback-$STAMP"
docker exec -e BACKUP_PATH="/app/data/backups/editio-before-$STAMP.sqlite" editio-backend \
  node --input-type=module -e 'import Database from "better-sqlite3"; const db = new Database(process.env.DATABASE_PATH || "/app/data/editio.sqlite"); await db.backup(process.env.BACKUP_PATH); db.close();'
docker exec -e BACKUP_PATH="/app/data/backups/editio-before-$STAMP.sqlite" editio-backend \
  node --input-type=module -e 'import Database from "better-sqlite3"; const db = new Database(process.env.BACKUP_PATH, { readonly: true }); const result = db.pragma("integrity_check", { simple: true }); db.close(); if (result !== "ok") throw new Error(`Integrity check failed: ${result}`); console.log("Backup integrity: ok");'
```

Record the generated `STAMP` in the deployment notes. Keep the backup outside the container lifecycle through the `/app/data` host mount and copy it to the normal encrypted backup destination.

## Immediate feature rollback

If quota, paywall, verification, or notification behavior is incorrect but the database remains healthy, disable monetization first. This preserves billing records and avoids losing post-deploy account activity.

```bash
cd /home/ubuntu/editio-backend
sed -i.bak 's/^MONETIZATION_ENABLED=.*/MONETIZATION_ENABLED=false/' .env.production
docker rm -f editio-backend
docker run -d \
  --name editio-backend \
  --restart unless-stopped \
  --cpus=2 \
  --memory=4g \
  -p 127.0.0.1:4000:4000 \
  -v /home/ubuntu/editio-backend/data:/app/data \
  --env-file .env.production \
  editio-backend:production
curl --fail --show-error https://api.editioapp.com/health
```

Rebuild the website with `MONETIZATION_LIVE=false`. The compatible mobile build derives its effective state from both flags and stops showing the paywall when the backend flag is false.

## Image rollback

If application code must be rolled back, keep the additive database schema and recreate the container from the recorded rollback image:

```bash
cd /home/ubuntu/editio-backend
ROLLBACK_STAMP="REPLACE_WITH_RECORDED_STAMP"
docker rm -f editio-backend
docker run -d \
  --name editio-backend \
  --restart unless-stopped \
  --cpus=2 \
  --memory=4g \
  -p 127.0.0.1:4000:4000 \
  -v /home/ubuntu/editio-backend/data:/app/data \
  --env-file .env.production \
  "editio-backend:rollback-$ROLLBACK_STAMP"
curl --fail --show-error https://api.editioapp.com/health
```

## Database restore (last resort)

The migration is additive and idempotent, so an image-only rollback is normally safer. Restoring the database loses accounts, history, quota events, and purchase updates written after the backup. Use this only during a maintenance window after stopping writes and confirming that forward repair is not possible.

```bash
cd /home/ubuntu/editio-backend
ROLLBACK_STAMP="REPLACE_WITH_RECORDED_STAMP"
docker stop editio-backend
cp -p data/editio.sqlite "data/backups/editio-failed-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
cp -p "data/backups/editio-before-$ROLLBACK_STAMP.sqlite" data/editio.sqlite.restore
rm -f data/editio.sqlite-wal data/editio.sqlite-shm
mv data/editio.sqlite.restore data/editio.sqlite
docker start editio-backend
curl --fail --show-error https://api.editioapp.com/health
```

After any rollback, verify login, account history, one unrestricted conversion with flags off, Notifications V2 reachability, and database integrity before ending maintenance.
