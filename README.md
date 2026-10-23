# Sako Supply

A responsive, single-store bigasan e-commerce research prototype. Built with vanilla JavaScript, CSS, Node.js and SQLite. No external application dependencies.

## Run

Requires Node.js 22.13+ (Node 24 recommended).

```sh
npm start
```

The application listens on port 3000. Override with `PORT`. SQLite data is stored in ignored `data/sako.sqlite`; override the directory with `DATA_DIR`. Orders and inventory survive server restarts. Admin sessions require a fresh login after restart.

## Demonstration

1. Browse and filter the rice catalog. Compare 5 kg and 25 kg bags.
2. Add products to the bag and adjust quantities.
3. Checkout using a sample name and phone number. Choose pickup (free) or local delivery (₱50). Save the order reference.
4. Open **Store admin** and sign in with the local demo password `sako-demo-2026`.
5. View the order, advance it through Pending → Preparing → Ready → Completed.
6. Show reserved inventory and the completed sales summary. Cancelling an active order restores its stock once.
7. Use Inventory to adjust available bags.

Use fictional customer details during the defense. Products, pricing and availability are sample data. No orders are actually fulfilled. Delivery coverage is subject to store confirmation.

## Validation

```sh
npm test
```

The integration test uses an isolated temporary database and exercises checkout pricing, stock reservation, insufficient-stock rejection, duplicate-item rejection, authentication, order transitions, cancellation restoration, inventory updates and logout.

## Scope and limitations

- One store and one administrator role. No customer accounts or public order history.
- Cash on pickup/delivery only; no payment gateway or automatic payment verification.
- Sales summary includes completed order totals, including delivery fees; it is not accounting or profit reporting.
- Each package size has its own stock count. No loose rice or sack repacking conversion.
- Rice package illustrations use CSS; no licensed product photography is bundled.
- Google Fonts are optional; local fallback fonts work without Internet access.

## Before a public deployment

Set a strong `ADMIN_PASSWORD` in the server environment; the documented fallback is for local demonstrations only. Add HTTPS with secure session cookies, login rate limiting, persistent/expiring sessions, customer privacy and retention controls, backups, and appropriate delivery/payment policies. This prototype has not undergone a production security review.

## Research alignment

Suggested title: **Sako Supply: A Web-Based Rice Ordering and Inventory Management System**.

| Objective | Implemented module |
| --- | --- |
| Provide online product browsing and ordering | Catalog, search, filters, cart and checkout |
| Track available rice stocks | Per-package inventory, stock reservation, cancellation restoration |
| Help the owner monitor transactions | Authenticated order dashboard and status progression |
| Summarize sales activity | Completed order sales and order count |

Architecture: browser → Node HTTP JSON API → SQLite database. Tables: products and orders (order items stored as an immutable JSON snapshot). The server calculates prices and validates stock; the browser cannot dictate order totals.
