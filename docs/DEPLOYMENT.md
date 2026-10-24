# Deploying Sako Supply

## Why the current app is unsuitable for Vercel functions

The app runs a Node HTTP server and uses Node's built-in SQLite module. `db.js` creates and writes a local SQLite database at startup; product uploads and scheduled backups also use disk. Vercel functions do not provide persistent local storage for this architecture. Writing the database into the deployed application directory can fail during startup. A `500 FUNCTION_INVOCATION_FAILED` screenshot alone does not establish the exact exception: check Vercel's runtime Logs for the first stack trace. An unsupported Node version or SQLite runtime can also prevent startup.

**Do not use `/tmp` as a production database fix.** Temporary storage is not shared durable storage; customers, sessions, orders and images can disappear or diverge across instances. A successful first page load would not prove the data is safe.

To stay on Vercel, redesign persistence around an external database and object storage, and adapt session cleanup, backups, transactions and request handling to that environment. This repository has not made that migration. Do not deploy only `public/`: the storefront needs its backend APIs.

## Render with a persistent disk

`render.yaml` prepares a native Node 24 web service with one instance, a persistent disk, and `/health` checking. **It selects a paid Starter service and a paid persistent disk. Review current pricing in Render before creating it.** No Render deployment or charge is initiated by committing this file. An ordinary free service without persistent storage is not sufficient for this SQLite app.

1. Sign in to Render and connect the GitHub account with access to `xynvm120/Sako-Supply`.
2. Choose **New → Blueprint**, select the repository and `main` branch, and use the root `render.yaml`.
3. Review the service/disk pricing. Set `ADMIN_PASSWORD` to a strong, unique password when asked. The default admin email in the blueprint is `admin@sakosupply.com`; change it if desired. Never commit a real password.
4. Deploy. The blueprint runs `npm ci --omit=dev --ignore-scripts`, then `npm start`, with Node 24. Render supplies `PORT`; the server already listens on `0.0.0.0`.
5. Open the service's HTTPS URL, then open `/health`. Expect JSON with `status: "ok"` and `database: "sqlite"`.
6. Register a fictional customer, place a demonstration order, upload a test product image as admin, and restart/redeploy the service. Confirm the account, order and uploaded image survive before using it for your defense.

If creating a Web Service manually, use the same build/start commands, Node 24, a disk mounted at `/var/data`, `DATA_DIR=/var/data/store`, and `BACKUP_DIR=/var/data/backups`. Use a **single instance**. Mount paths must be absolute and writable by the app. Do not expose a database or backup directory as a public static folder.

A new disk starts with a fresh database and demo catalog. It does **not** import accounts/orders/images from your Windows laptop. To migrate existing data, stop writes, take a backup, and transfer the database plus uploads privately to the configured data directory. Do not commit customer data to GitHub or overwrite a live database without a verified backup.

## Optional account email activation

In the service's Environment settings, set private `EMAIL_API_KEY`, verified `EMAIL_FROM`, and `PUBLIC_URL` to the actual HTTPS origin (for example your assigned Render URL). Add a real `SUPPORT_EMAIL` if available. Redeploy and test a verification message and password reset using an inbox you control. No email key or inbox delivery is included in this deployment configuration. Recovery remains admin-assisted until email is configured.

## Backup and demo limits

The automatic backup timer runs only while the service is running. The disk stores database/uploads and backups under different subdirectories, but they are still on the **same disk**; download private backups to another device for disaster recovery. Run `npm run backup` in the service shell when needed. Disk-backed hosting does not turn demo payments or the illustrated delivery route into live financial/GPS services.

## If you need to present without paid hosting

Use Node 24 on your Windows laptop, start with `npm start` in the project directory, and open `http://localhost:3000`. This is a working local demonstration, not a publicly deployed website. Keep the laptop running during your presentation and retain your existing `data` folder.

Provider references (check current limits/pricing in the provider dashboard):
- https://vercel.com/docs/functions/runtimes/node-js
- https://render.com/docs/disks
- https://render.com/docs/blueprint-spec

The native production install/start and persistence checks can be tested locally. A live Render deployment has not been verified in this workspace.
