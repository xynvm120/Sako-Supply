# Requested improvements: implementation status

## Implemented in this update

- CSP with self-hosted scripts and assets; inline styles allowed for Leaflet/layout. Stored-text escaping audited, with browser XSS probes.
- Failed-login limits by IP+email, a broader failed-IP cap, separate registration/order submission limits, bounded limiter storage, and Retry-After responses.
- Session cleanup at startup/every 15 minutes. The requested demo password remains; startup warns when it is used.
- Admin actor/action/target/time audit log and dashboard viewer. Image upload magic-byte checks retained; JSON body parsing is now byte-counted and preserves chunked UTF-8.
- DB/auth/security/pricing/reporting modules and split CSS. The browser application and router can be split further later.
- Stock SQL checks for new databases and validation triggers for legacy tables; order user/date/status indexes; integer-centavo pricing and monetary snapshots.
- Integration tests for expiry, throttling, two-process concurrent last-sack orders, and stored text; no assertions disabled.
- 10+/25+ sack discounts, reorder, zone fees, per-product reorder points, Pending customer cancellation, and an in-app notification log.
- Daily/weekly completed-sales charts with accessible data tables; separate collected-cash ledger using payment collection dates.
- Leaflet street maps (OpenStreetMap initially, optional MapTiler) with explicit driver device geolocation sharing, order-scoped expiring access, stop/revoke, and stale-fix labels. No generated movement, automatic geocoding, ETA, route history or road routing. Live provider/hardware availability still requires deployment verification.
- Basic PWA manifest/icons and a network-first public app shell. No private API caching or offline checkout.
- Manual and nightly SQL/upload backups, backup integrity test, Dockerfile, .env.example, GitHub Actions test workflow, request logging, and /health.
- Local tutorial video with controls/captions/transcript and a rubric-specific defense checklist.

## Deliberately retained for compatibility

Historical orders.items JSON is retained rather than dropped because users may have earlier local databases. Normalized order_items is authoritative and new order writes update both inside the same transaction. Existing receipts and uploaded photos are preserved. Legacy peso fields remain readable alongside integer-centavo snapshots; no database is reset.

The configured admin identity still has no customer user_id; its email is persisted as the session actor and in the audit log. Multiple staff identities/permissions are a separate feature.

## Remaining optional work — not claimed as implemented

- Customer credit/pay-later accounting, credit limits, partial payments, and refunds/aging rules.
- Cashier/staff accounts and role-specific permissions beyond customer/admin.
- Product cost snapshots, margin and profit accounting.
- Live account email activation: verified-email and recovery flows plus a Resend adapter are implemented and tested with a local provider substitute. Real delivery requires EMAIL_API_KEY, verified EMAIL_FROM and PUBLIC_URL; no live inbox delivery has been claimed. Admin-assisted recovery remains available.
- Multiple saved addresses and real address autocomplete/geocoding.
- Complete Filipino/Bisaya localization, including validation messages and product content.
- Real email/SMS notifications; the current in-app log sends nothing externally.
- Real merchant card/GCash/Maya processing. Device GPS sharing is implemented; a continuously running background driver app, attested locations and turn-by-turn routing are not.

These were outside the prioritized defense pass. Real payment/location services also require accounts, credentials, and operational decisions that were not supplied. No values or credentials were invented.

## Container validation limitation

The Dockerfile was exercised through base-image retrieval and build execution, but this cloud machine's Docker build network could not resolve the package registry/proxy (EAI_AGAIN). No TLS or integrity verification was disabled. Native npm installation and all application tests remain independent of that Docker network issue. A completed Docker image build/run is not claimed. Build it on a machine with working container DNS/egress before using it for deployment.
