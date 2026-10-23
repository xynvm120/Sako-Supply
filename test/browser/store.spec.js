import { test, expect } from "@playwright/test";
import path from "node:path";
test("customer wholesale purchase, demo card, receipt printing, and delivery map", async ({
  page,
  playwright,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator(".product")).toHaveCount(5);
  await page.screenshot({ path: "/tmp/sako-desktop.png", fullPage: true });
  await page
    .getByRole("button", { name: "View Dinorado details", exact: true })
    .click();
  const detail = page.locator("#product-dialog");
  await expect(detail).toContainText("Texture & character");
  await detail.getByLabel("Number of sacks").fill("5");
  await detail.getByRole("button", { name: "Add to bag" }).click();
  await detail.getByRole("button", { name: "Close", exact: true }).click();
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
  await page.getByRole("button", { name: "Create account →" }).click();
  await expect(page.locator("#account-dialog")).not.toBeVisible();
  const cart = page.locator("#cart-dialog");
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
  await cart.getByRole("button", { name: "Place demo order" }).click();
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
  await cart.getByRole("button", { name: "View order / tracking" }).click();
  await expect(page.locator("#detail-content")).toContainText(
    "SIMULATED TRACKING",
  );
  await expect(page.locator(".leaflet-container")).toBeVisible();
  const admin = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:32189",
  });
  await admin.post("/api/login", {
    data: { password: "browser-admin-password" },
  });
  await admin.patch("/api/admin/status", {
    data: { id: order.id, status: "Preparing" },
  });
  await admin.patch("/api/admin/status", {
    data: { id: order.id, status: "Out for delivery" },
  });
  await page
    .getByRole("button", { name: "Refresh status", exact: true })
    .click();
  await expect(page.locator("#tracking-label")).toContainText(
    "Out for delivery",
  );
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
  await page.locator("#admin-link").click();
  await page.getByLabel("Admin password").fill("browser-admin-password");
  await page.locator("#login").getByRole("button").click();
  await expect(page.locator("#admin-panel")).toContainText(
    "A good day to do business.",
  );
  await page.screenshot({ path: "/tmp/sako-dashboard.png" });
  await page.getByRole("button", { name: "Products & inventory" }).click();
  await page.getByRole("button", { name: "Add product" }).click();
  const editor = page.locator("#editor-dialog");
  await editor.getByLabel("Rice name", { exact: true }).fill("Demo white rice");
  await editor.getByLabel("Short description").fill("Sample local supply");
  await editor
    .getByLabel("Product description")
    .fill("A fictional sample product for a browser test.");
  await editor.getByRole("button", { name: "Save product" }).click();
  await expect(page.locator("#admin-panel")).toContainText("Demo white rice");
  const row = page
    .locator(".admin-table tr")
    .filter({ hasText: "Demo white rice" });
  await row.getByRole("button", { name: "Adjust stock" }).click();
  await editor.getByLabel("Adjustment in sacks").fill("20");
  await editor.getByLabel("Reason").fill("Browser test supplier delivery");
  await editor.getByRole("button", { name: "Record adjustment" }).click();
  await expect(page.locator("#admin-panel")).toContainText(
    "Browser test supplier delivery",
  );
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
