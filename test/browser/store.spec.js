import { test, expect } from "@playwright/test";

test("customer wholesale purchase, demo card, receipt printing, and delivery map", async ({
  page,
  playwright,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator(".product")).toHaveCount(5);
  await page.screenshot({ path: "/tmp/sako-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const headerBounds = await page.locator("header").boundingBox();
  const navBounds = await page.locator("header nav").boundingBox();
  expect(navBounds.y + navBounds.height).toBeLessThanOrEqual(
    headerBounds.y + headerBounds.height,
  );
  await page.screenshot({ path: "/tmp/sako-guest-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page
    .getByRole("button", { name: "View Dinorado details", exact: true })
    .click();
  const detail = page.locator("#product-dialog");
  await expect(detail).toContainText("Texture & character");
  await detail.getByLabel("Number of sacks").fill("5");
  await detail.getByRole("button", { name: "Add to bag" }).click();
  await detail.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator("#admin-link")).toBeHidden();
  await page.locator("#cart-button").click();
  await page.getByRole("button", { name: "Sign in to order" }).click();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page
    .getByLabel("Full name", { exact: true })
    .fill("Demo Wholesale Buyer");
  await page.getByLabel("Email address").fill("browser-buyer@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("defense-password-2026");
  await page.getByRole("checkbox", { name: /I agree/ }).check();
  await page.getByRole("button", { name: "Create account →" }).click();
  await expect(page.locator("#account-dialog")).not.toBeVisible();
  const cart = page.locator("#cart-dialog");
  await expect(page.locator("#admin-link")).toBeHidden();
  await expect(cart.getByLabel("Receive your order")).toHaveValue("");
  await cart.getByLabel("Mobile number").fill("09123456789");
  await cart.getByLabel("Receive your order").selectOption("delivery");
  await cart
    .getByLabel("Delivery address")
    .fill("Fictional demo delivery address");
  await cart.getByLabel("Payment method").selectOption("card");
  await cart.getByLabel("Test card number").fill("4242 4242 4242 4242");
  await cart.getByLabel("Expiry (MM/YY)").fill("12/30");
  await cart.getByLabel("Test CVC").fill("123");
  const orderRequest = page.waitForRequest(
    (r) => r.url().endsWith("/api/orders") && r.method() === "POST",
  );
  await cart.getByRole("button", { name: "Place order" }).click();
  const submitted = (await orderRequest).postDataJSON();
  expect(submitted.cardNumber).toBeUndefined();
  expect(JSON.stringify(submitted)).not.toContain("4242");
  await expect(cart).toContainText("Your sacks are reserved.");
  await expect(cart).toContainText("Demo paid");
  const orders = await page.request.get("/api/orders");
  const order = (await orders.json())[0];
  expect(order.items[0].quantity).toBe(5);
  await cart.getByRole("button", { name: "View & print receipt" }).click();
  await expect(page.locator("#receipt-content")).toContainText(order.id);
  await expect(page.locator("#receipt-content")).toContainText("25 kg");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("main")).not.toBeVisible();
  await expect(page.locator("#receipt-content")).toBeVisible();
  await page.pdf({ path: "/tmp/sako-receipt.pdf", format: "A4" });
  await page.emulateMedia({ media: "screen" });
  await page
    .locator("#receipt-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await cart.getByRole("button", { name: "Open delivery map" }).click();
  await expect(page.locator("#detail-content")).toContainText(
    "Demo tracking",
  );
  await expect(page.locator(".leaflet-container")).toBeVisible();
  const admin = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:32189",
  });
  await admin.post("/api/login", {
    data: { email: "admin@sakosupply.com", password: "browser-admin-password" },
  });
  await admin.patch("/api/admin/status", {
    data: { id: order.id, status: "Preparing" },
  });
  await admin.patch("/api/admin/status", {
    data: { id: order.id, status: "Out for delivery" },
  });
  await expect(page.locator("#tracking-label")).toContainText(
    "Out for delivery",
    { timeout: 12000 },
  );
  await expect(page.locator("#live-order-status")).toContainText(
    "Out for delivery",
  );
  await expect(page.locator("#live-timeline")).toContainText(
    "Out for delivery",
  );
  await expect(page.locator("img.leaflet-image-layer")).toBeVisible();
  const first = (
    await (await admin.get(`/api/orders/${order.id}/tracking`)).json()
  ).progress;
  await page.waitForTimeout(1100);
  const second = (
    await (await admin.get(`/api/orders/${order.id}/tracking`)).json()
  ).progress;
  expect(second).toBeGreaterThan(first);
  await page.locator("#delivery-map").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/sako-tracking.png" });
  await admin.dispose();
  await page
    .locator("#detail-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await cart.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator("#orders-link").click();
  await expect(page.locator("#orders-content")).toContainText(order.id);
  await page
    .locator("#orders-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.locator("#account-link").click();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.locator("#account-link")).toHaveText("Sign in");
  expect(errors).toEqual([]);
});
test("admin dashboard product management, stock, customer history, and report export", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("#account-link").click();
  await expect(page.locator("#admin-link")).toBeHidden();
  await page.getByLabel("Email address").fill("admin@sakosupply.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-admin-password");
  await page.locator("#customer-auth").getByRole("button").click();
  await expect(page.locator("#admin-link")).toBeVisible();
  await expect(page.locator("#admin-panel")).toContainText(
    "A good day to do business.",
  );
  await expect(
    page.getByRole("heading", { name: "Daily sales · last 7 days" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Weekly sales · last 28 days" }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/sako-dashboard.png" });
  await page.getByRole("button", { name: "Products & inventory" }).click();
  await page.getByRole("button", { name: "Add product" }).click();
  const editor = page.locator("#editor-dialog");
  await editor.getByLabel("Rice name", { exact: true }).fill("Demo white rice");
  await editor.getByLabel("Short description").fill("Sample local supply");
  await editor
    .getByLabel("Product description")
    .fill("A fictional sample product for a browser test.");
  const photoOne = await page.screenshot();
  await editor.getByLabel("Choose product image").setInputFiles({
    name: "rice-one.png",
    mimeType: "image/png",
    buffer: photoOne,
  });
  await expect(editor.locator("#product-photo-preview img")).toBeVisible();
  await editor.getByRole("button", { name: "Save product" }).click();
  await expect(page.locator("#admin-panel")).toContainText("Demo white rice");
  const row = page
    .locator("#admin-panel .admin-table")
    .first()
    .locator("tr")
    .filter({ hasText: "Demo white rice" });
  await expect(row.locator("img")).toBeVisible();
  const originalPhoto = await row.locator("img").getAttribute("src");
  await row.getByRole("button", { name: "Change image" }).click();
  await expect(editor.locator("#product-photo-preview img")).toHaveAttribute(
    "src",
    originalPhoto,
  );
  const photoTwo = await page.screenshot();
  await editor.getByLabel("Choose product image").setInputFiles({
    name: "rice-two.png",
    mimeType: "image/png",
    buffer: photoTwo,
  });
  await editor.getByRole("button", { name: "Save product" }).click();
  await expect(row.locator("img")).not.toHaveAttribute("src", originalPhoto);
  const replacementPhoto = await row.locator("img").getAttribute("src");
  await page.reload();
  await page.locator("#admin-link").click();
  await expect(page.locator("#admin-panel")).toContainText(
    "A good day to do business.",
  );
  await page.getByRole("button", { name: "Products & inventory" }).click();
  await expect(row.locator("img")).toHaveAttribute("src", replacementPhoto);
  await row.getByRole("button", { name: "Change image" }).click();
  await editor
    .getByRole("button", { name: "Remove image", exact: true })
    .click();
  await editor.getByRole("button", { name: "Save product" }).click();
  await expect(row.locator("img")).toHaveCount(0);
  await row.getByRole("button", { name: "Adjust stock" }).click();
  await editor.getByLabel("Adjustment in sacks").fill("20");
  await editor.getByLabel("Reason").fill("Browser test supplier delivery");
  await editor.getByRole("button", { name: "Record adjustment" }).click();
  await expect(page.locator("#admin-panel")).toContainText(
    "Browser test supplier delivery",
  );
  await row.getByRole("button", { name: "Stock alert", exact: true }).click();
  await editor
    .getByLabel("Alert when stock reaches this many sacks")
    .fill("12");
  await editor.getByRole("button", { name: "Save reorder point" }).click();
  await expect(row).toContainText("Reorder point: 12");
  await page.getByRole("button", { name: "Customers", exact: false }).click();
  await expect(page.locator("#admin-panel")).toContainText(
    "Demo Wholesale Buyer",
  );
  await page
    .getByRole("button", { name: "Order history", exact: true })
    .click();
  await expect(page.locator("#admin-panel")).toContainText(
    "Showing this customer",
  );
  await page.getByRole("button", { name: "Reports", exact: false }).click();
  await expect(page.locator("#admin-panel")).toContainText("Sales reports");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toBe("sako-sales.csv");
  await page.getByRole("button", { name: "Log out", exact: false }).click();
  await expect(page.locator("#admin-dialog")).not.toBeVisible();
  await expect(page.locator("#admin-link")).toBeHidden();
  expect(errors).toEqual([]);
});
test("mobile storefront, search and product modal fit a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".product").first()).toBeVisible();
  await page.getByRole("button", { name: "Whole grain", exact: true }).click();
  await expect(page.locator(".product")).toHaveCount(1);
  await page.getByRole("button", { name: "View Brown rice details" }).click();
  await expect(page.locator("#product-dialog")).toContainText("Cooking notes");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/sako-mobile-detail.png" });
  await page
    .locator("#product-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "All rice", exact: true }).click();
  await page.getByLabel("Search rice", { exact: true }).fill("Sinandomeng");
  await expect(page.locator(".product")).toHaveCount(1);
  await page.getByLabel("Search rice", { exact: true }).fill("");
  await page.screenshot({ path: "/tmp/sako-mobile.png", fullPage: true });
});

test("pickup orders explain why no map is shown and refresh status automatically", async ({
  page,
  playwright,
}) => {
  await page.goto("/");
  await page.request.post("/api/auth/register", {
    data: {
      name: "Pickup Buyer",
      email: "pickup-browser@example.test",
      password: "pickup-password-123",
    },
  });
  await page.reload();
  await expect(page.locator("#account-link")).toContainText("Pickup");
  const placed = await page.request.post("/api/orders", {
    data: {
      customer: "Pickup Buyer",
      phone: "09123456789",
      method: "pickup",
      payment_method: "cash",
      items: [{ id: 1, quantity: 1 }],
    },
  });
  const order = await placed.json();
  await page.locator("#orders-link").click();
  await page.locator("#orders-content [data-order]").click();
  await expect(page.locator(".pickup-card")).toContainText(
    "You chose store pickup",
  );
  await expect(page.locator("#delivery-map")).toHaveCount(0);
  const admin = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:32189",
  });
  await admin.post("/api/login", {
    data: { email: "admin@sakosupply.com", password: "browser-admin-password" },
  });
  await admin.patch("/api/admin/status", {
    data: { id: order.id, status: "Preparing" },
  });
  await admin.patch("/api/admin/status", {
    data: { id: order.id, status: "Ready for pickup" },
  });
  await expect(page.locator("#live-order-status")).toContainText(
    "Ready for pickup",
    { timeout: 12000 },
  );
  await admin.dispose();
});
test("delivery map works locally without external tile access", async ({
  page,
}) => {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await page.goto("/");
  await page.request.post("/api/auth/register", {
    data: {
      name: "Offline Map Buyer",
      email: "offline-map@example.test",
      password: "offline-password-123",
    },
  });
  await page.reload();
  await page.request.post("/api/orders", {
    data: {
      customer: "Offline Map Buyer",
      phone: "09123456789",
      address: "Fictional destination",
      method: "delivery",
      payment_method: "cash",
      items: [{ id: 1, quantity: 1 }],
    },
  });
  await page.locator("#orders-link").click();
  await page.locator("#orders-content [data-order]").click();
  await expect(page.locator("#delivery-map")).toBeVisible();
  await expect(page.locator("img.leaflet-image-layer")).toHaveAttribute(
    "src",
    "/assets/demo-map.svg",
  );
  await expect(page.locator("img.leaflet-image-layer")).toBeVisible();
  await expect(page.locator("#map-tile-note")).toBeVisible();

  await expect(page.locator("#tracking-label")).toContainText(
    "Waiting for the admin",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#delivery-map")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator("#delivery-map").scrollIntoViewIfNeeded();
  await expect(page.locator(".truck-marker")).toBeInViewport();
  await page.screenshot({ path: "/tmp/sako-mobile-tracking.png" });
});
test("portrait product photos fit cards and details without cropping or covering labels", async ({
  page,
}) => {
  await page.goto("/");
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 1000;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#72a73c";
    ctx.fillRect(0, 0, 320, 1000);
    ctx.fillStyle = "#fff";
    ctx.font = "30px sans-serif";
    ctx.fillText("TOP OF SACK", 30, 45);
    ctx.fillText("BOTTOM", 30, 970);
    return canvas.toDataURL("image/png");
  });
  await page.route("**/api/products", async (route) => {
    const response = await route.fetch();
    const products = await response.json();
    products[0].image = image;
    await route.fulfill({ response, json: products });
  });
  await page.reload();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const card = page.locator(".product").first(),
      photo = card.locator(".rice-photo");
    await expect(photo).toBeVisible();
    const img = await photo.boundingBox(),
      area = await card.locator(".product-art").boundingBox(),
      tag = await card.locator(".tag").boundingBox(),
      link = await card.locator(".weight").boundingBox();
    expect(img.y).toBeGreaterThanOrEqual(tag.y + tag.height);
    expect(img.y + img.height).toBeLessThanOrEqual(link.y);
    expect(img.x).toBeGreaterThanOrEqual(area.x);
    expect(img.x + img.width).toBeLessThanOrEqual(area.x + area.width);
    expect(await photo.evaluate((img) => getComputedStyle(img).objectFit)).toBe(
      "contain",
    );
    await card.screenshot({ path: `/tmp/sako-photo-${width}.png` });
    await card.locator(".product-art").click();
    const detail = page.locator("#product-dialog"),
      detailImage = detail.locator(".rice-photo");
    await expect(detailImage).toBeVisible();
    const di = await detailImage.boundingBox(),
      da = await detail.locator(".product-art").boundingBox();
    expect(di.y + di.height).toBeLessThanOrEqual(da.y + da.height);
    expect(di.y).toBeGreaterThanOrEqual(da.y);
    await detail.getByRole("button", { name: "Close", exact: true }).click();
  }
});
test("dark mode follows system preference, persists a manual choice, and styles admin", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Switch to light mode" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.locator("#account-link").click();
  await expect(page.locator("#account-dialog")).toBeVisible();
  await page
    .locator("#account-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/sako-dark-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator("#account-link").click();
  await page.getByLabel("Email address").fill("admin@sakosupply.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-admin-password");
  await page.locator("#customer-auth").getByRole("button").click();
  await expect(page.locator("#admin-panel")).toBeVisible();
  await expect(page.locator("#admin-dialog")).toHaveCSS(
    "color",
    "rgb(228, 237, 223)",
  );
  await page.screenshot({ path: "/tmp/sako-dark-admin.png" });
});
test("standard rice products have bundled images and accessible enlarged views", async ({
  page,
}) => {
  await page.goto("/");
  const products = await (await page.request.get("/api/products")).json();
  const standards = products.filter((p) => p.default_image);
  expect(standards).toHaveLength(5);
  for (const product of standards) {
    const response = await page.request.get(product.default_image);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/png");
    const card = page
      .locator(".product")
      .filter({ has: page.locator(`[data-detail="${product.id}"]`) });
    await expect(card.locator(".rice-photo")).toHaveAttribute(
      "src",
      product.image || product.default_image,
    );
    await expect
      .poll(() =>
        card
          .locator(".rice-photo")
          .evaluate((img) => img.complete && img.naturalWidth > 0),
      )
      .toBe(true);
    await card.locator(".product-art").click();
    await page
      .getByRole("button", {
        name: `Enlarge ${product.name} image`,
        exact: true,
      })
      .click();
    await expect(page.locator("#image-viewer-content img")).toHaveAttribute(
      "src",
      product.image || product.default_image,
    );
    await expect(page.locator("#image-viewer-dialog")).toContainText("mockup");
    await page.keyboard.press("Escape");
    await expect(page.locator("#product-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await page.screenshot({
    path: "/tmp/sako-product-images.png",
    fullPage: true,
  });
});

test("bulk tiers, zone fees, reorder, pending cancellation, and in-app updates work together", async ({
  page,
}) => {
  await page.goto("/");
  await page.request.post("/api/auth/register", {
    data: {
      name: "Bulk Buyer",
      email: "bulk-ui@example.test",
      password: "bulk-ui-password",
    },
  });
  await page.reload();
  await page
    .getByRole("button", { name: "View Dinorado details", exact: true })
    .click();
  await page.getByLabel("Number of sacks").fill("10");
  await page.locator("#detail-add").getByRole("button").click();
  await page
    .locator("#product-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.locator("#cart-button").click();
  await page.getByLabel("Mobile number").fill("09123456789");
  await page.getByLabel("Receive your order").selectOption("delivery");
  await page
    .getByRole("combobox", { name: "Delivery zone", exact: true })
    .selectOption("tupi");
  await page.getByLabel("Delivery address").fill("Fictional Tupi address");
  await expect(page.locator("#cart-discount")).toContainText("250.00");
  await expect(page.locator("#checkout-total")).toContainText("14,550.00");
  await page.getByRole("button", { name: "Place order" }).click();
  await page.locator("#success-receipt").waitFor();
  await page.locator("#success-receipt").click();
  await expect(page.locator("#receipt-content")).toContainText("Bulk discount");
  await expect(page.locator("#receipt-content .receipt-totals")).toContainText(
    "14,500.00",
  );
  await expect(page.locator("#receipt-content tbody")).toContainText(
    "1,450.00",
  );
  await expect(page.locator("#receipt-content .grand")).toContainText(
    "14,550.00",
  );
  await page
    .locator("#receipt-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page
    .locator("#cart-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.locator("#orders-link").click();
  await page.getByRole("button", { name: "Reorder", exact: true }).click();
  await expect(page.locator("#cart-dialog")).toBeVisible();
  await expect(page.locator(".cart-qty")).toHaveValue("10");
  await page
    .locator("#cart-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel order", exact: true }).click();
  await expect(page.locator("#orders-content")).toContainText("Cancelled");
  await page
    .locator("#orders-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.locator("#notifications-link").click();
  await expect(page.locator("#notifications-content")).toContainText(
    "cancelled",
  );
});
test("rubric navigation, local video playback, CSP, and service worker do not fail", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("/");
  expect(response.headers()["content-security-policy"]).toContain(
    "script-src 'self'",
  );
  await page.getByRole("link", { name: "How to order", exact: true }).click();
  await expect(page.locator("#how-to-order")).toBeInViewport();
  const video = page.locator("video");
  await expect
    .poll(() =>
      video.evaluate((v) => Number.isFinite(v.duration) && v.duration > 0),
    )
    .toBe(true);
  await video.evaluate((v) => v.play());
  await expect
    .poll(() => video.evaluate((v) => v.currentTime))
    .toBeGreaterThan(0);
  await video.evaluate((v) => v.pause());
  expect(
    await page.evaluate(async () =>
      Boolean(await navigator.serviceWorker.ready),
    ),
  ).toBe(true);
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).start_url).toBe("/");
  for (const link of await page.locator('a[href^="#"]').all()) {
    const target = await link.getAttribute("href");
    if (target && target !== "#")
      expect(await page.locator(target).count()).toBe(1);
  }
  expect(errors).toEqual([]);
});
test("stored customer markup is rendered as text in profiles, orders, and receipts", async ({
  page,
}) => {
  const payload =
    '<img class="xss-probe" src=x onerror="window.injected=true">';
  await page.goto("/");
  await page.request.post("/api/auth/register", {
    data: {
      name: payload,
      email: "escaping-ui@example.test",
      password: "escaping-password-123",
    },
  });
  await page.reload();
  await page.locator("#account-link").click();
  await expect(page.locator('input[name="name"]')).toHaveValue(payload);
  await page
    .locator("#account-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.request.post("/api/orders", {
    data: {
      customer: payload,
      phone: "09123456789",
      method: "delivery",
      delivery_zone: "koronadal",
      address: payload,
      payment_method: "cash",
      items: [{ id: 1, quantity: 1 }],
    },
  });
  await page.locator("#orders-link").click();
  await page
    .getByRole("button", { name: "Receipt / Print", exact: true })
    .click();
  await expect(page.locator("#receipt-content")).toContainText(payload);
  await expect(page.locator(".xss-probe")).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});

test("policy navigation, signup acknowledgment, and customer recovery form", async ({page}) => {
  await page.goto('/');
  await page.locator('footer').getByRole('link',{name:'Privacy Policy'}).click();
  await expect(page.getByRole('heading',{name:'Privacy Policy',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'User Agreement'}).click();
  await expect(page.getByRole('heading',{name:'User Agreement',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Back to Sako Supply'}).click();
  await page.locator('#account-link').click();
  await page.getByRole('button',{name:'Forgot password?'}).click();
  await page.getByLabel('Email address').fill('unknown@example.test');
  await page.getByLabel('Recovery code').fill('invalid-code');
  await page.getByLabel('New password').fill('new-password-123');
  await page.getByRole('button',{name:'Reset password',exact:true}).click();
  await expect(page.locator('#reset-message')).toHaveText('Invalid or expired recovery code.');
  await page.getByRole('button',{name:'Back to sign in'}).click();
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:/I agree/})).toHaveAttribute('required','');
});
