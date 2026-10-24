# Street maps and driver GPS

The current map uses Leaflet with real street tiles. Coordinates come from a driver browser's Geolocation API, never from a timer or fixed sample route. Backend integration and browser tests verify data flow; browser GPS and map tiles are mocked in automated tests. A live physical phone and provider/network still need an end-to-end check on your hosted site.

## Use it

1. Place a **delivery** order. Pickup orders do not have driver tracking.
2. Sign in as admin, open **Orders → View** for the order, and set **Preparing → Out for delivery**.
3. In that order's details select **Issue driver link**. Copy the complete private link, including `#...`, and give it only to the assigned driver. It lasts 12 hours. Issuing a new link invalidates the previous one and removes the last fix. **Revoke driver link** removes access and the last fix.
4. The driver opens the link on their phone, reads the location notice, checks the consent box and presses **Start sharing location**. Allow location access. The device must use HTTPS, remain online with location enabled, and keep the page visible/unlocked. Browser location may use GPS, Wi-Fi or network positioning; accuracy varies.
5. The customer opens **My Orders → Details & tracking**. Their map checks the server every five seconds. A marker appears only after a device fix arrives, with its accuracy and receive time. Fixes over 90 seconds old are explicitly stale. Customers see only their own delivery's location; admins can view order locations.
6. The driver can press **Stop sharing**, uncheck consent, or leave/hide the page. Sharing stops and a deletion is attempted. If the device is offline a last fix may remain, labelled stale. Completion/cancellation also invalidates access and deletes the current fix server-side.

A browser geolocation callback is not guaranteed every five seconds. Updates are throttled to at most one per five seconds, require a new device observation and must reach the server. Do not promise continuous background tracking: that requires a dedicated mobile implementation. Keep device clocks correct. Stopped sharing can be resumed with the same valid link and renewed explicit Start action.

## Hosting and localhost

A phone cannot reach your laptop by opening `localhost`: that means the phone itself. `http://192.168...` is generally not a secure context for browser GPS. Use a reachable HTTPS deployment with persistent storage, such as the disk-backed server described in DEPLOYMENT.md. Vercel's local SQLite limitation is unchanged. Localhost allows a functional desktop test, but laptop positioning may be less accurate than phone GPS. No HTTPS deployment or physical-device test is created by committing this feature.

## Map provider

OpenStreetMap standard tiles are the initial default, with visible attribution. They require internet and compliance with the provider's usage policy, and are not an unlimited/SLA-backed production service. No bulk downloading, tile proxy, offline map caching or prefetch is implemented. The app sends an origin referrer (`strict-origin-when-cross-origin`), which standard OSM tiles expect. An Access blocked response can still reflect provider/network restrictions. Failures show a useful error instead of replacing streets with an illustration. Browser CSP allows images only from the two supported map hosts in addition to local/data/blob sources.

If OSM is blocked or you need a dedicated provider, obtain a MapTiler account and configure `MAPTILER_KEY` on the server, then restart. This is a **public browser map key**, so restrict its allowed origins in MapTiler and review its plan limits. It is deliberately included in the public map configuration; it is not a private server credential. Never use a secret administrative API key. No MapTiler account/key is bundled. GPS updates can still be read as status/coordinates when tile loading fails.

## Privacy and limits

Driver tokens are high-entropy, hashed in SQLite, expire after 12 hours and are scoped to one order. The driver page clears the token from its address bar and keeps it only in memory: reopening/refeshing requires the original complete link. Tokens are sent as Authorization headers, not URL query parameters. Driver pages/API responses are not cached by the service worker. The token grants location-submission access, not access to customer records or other orders. Anyone holding a link can submit location for that order; this does not attest the driver's identity or prevent browser GPS spoofing.

Only the latest coordinate/accuracy/observation/receive time is stored in the working database. Expired/orphaned fixes and fixes older than 24 hours are cleaned at startup and every minute while the server runs. Backups can retain older copies; protect them and apply a retention/deletion policy. Revocation, stopping and completion clear the current fix but do not rewrite existing backups. Driver location data is private and must not be committed to GitHub.

The initial map is centered on the Koronadal area for browsing only: it does not assert the store's location. Customer addresses are displayed as text. No destination pin, route, ETA, arrival percentage or distance is guessed. Use a separate verified navigation arrangement for actual deliveries. Old orders retain their existing fulfillment method. Older research documents/screenshots may describe the previous illustrated simulation and must be updated before presenting this implementation.
