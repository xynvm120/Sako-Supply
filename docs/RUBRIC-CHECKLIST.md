# IT 201 final website defense checklist

Source: the user-supplied **Final-Defense-Format-IT-201.docx**. The format has four categories worth up to 20 points each (80 total). This checklist aligns software evidence with the rubric; it does not award a grade or claim instructor approval.

| Rubric category             | Website evidence                                                                                                                                                                                                                                                     | Validation / demonstration                                                                                                                                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code Quality & Organization | SQL setup/migrations in db.js; authentication/session helpers in auth.js; security, pricing, HTTP-body and backup services; reporting route module; local CSS modules for base, components, storefront, themes and features; readable formatting and automated tests | Explain the browser → Node → SQLite architecture. Show server-side pricing, a SQL transaction, and the two-process last-sack test. The browser app and main router remain larger files; further modularization is possible.                                     |
| Graphics                    | Five relevant Sako 25 kg packaging mockups, a local rice-field hero illustration, product-image enlargement, and a Leaflet street map with assigned-driver GPS                                                                                                                  | Open each rice detail and image viewer. Explain that generated mockups are not commercial supplier photographs. Upload a replacement as admin.                                                                                                                  |
| Appearance / Design         | Consistent green/mint palette, rounded cards, spacing, readable forms, responsive layout, light/dark mode, and print-specific receipt styles                                                                                                                         | Show desktop and phone-sized views, toggle the theme, and print/save a receipt. Browser checks cover layout and photo bounds; subjective design assessment is still the panel's decision.                                                                       |
| Navigation and Links        | Catalog, filters/search, account login/logout, order history, notifications, receipt viewer, role-protected dashboard, and How to order section                                                                                                                      | Internal anchor targets are checked in browser tests. The bundled walkthrough video is tested for finite duration and actual playback; captions and written instructions are available. External Node/GitHub documentation links still require Internet access. |

## Suggested six-minute demonstration

1. Open the homepage. Point out relevant images and the theme toggle.
2. Play the short **How to order** video and show its written steps.
3. Sign in as a fictional customer, open Dinorado, add ten sacks, choose Tupi delivery, and explain ₱250 bulk savings and the ₱300 demo fee.
4. Place the demo order and print its itemized receipt. Explain that electronic payments are simulated.
5. In a second/incognito browser, sign in as admin. Show daily/weekly charts, inventory reorder points, and order processing.
6. Dispatch the order, issue a private driver link, explicitly share GPS and return to the customer's street map. Explain device accuracy, stale fixes and the need for HTTPS. Automated browser GPS is mocked, not proof of live hardware availability.
7. Show a separate Pending order cancellation, stock restoration, notification, and the admin audit. For cash collection, explicitly record payment and view the collection ledger.

## Before presenting on your laptop

- Stop the old server, preserve `data/`, and update the **complete project**. New modules and local CSS files are required; replacing only style.css is insufficient.
- Run `npm install`, `npm test`, then `npm start`. Use Node 24.
- Open the website in the actual browser you will present with. Confirm video playback, receipt printing, and admin/customer sign-ins.
- Use fictional contact details. Do not put real card data into demo fields.
- If a previous browser service worker exists, a reload fetches the latest static files. Use Ctrl+F5; if an obsolete version persists, unregister that site's service worker in browser developer tools, then reload.
- Record real user feedback separately. Automated tests do not constitute completed UAT, surveys, or an ISO 25010 evaluation.
