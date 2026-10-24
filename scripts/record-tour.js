// Creates the bundled silent defense walkthrough using an isolated demonstration database.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = mkdtempSync(path.join(os.tmpdir(), "sako-tour-db-")),
  frames = process.env.TOUR_FRAMES || "/tmp/sako-tour";
mkdirSync(frames, { recursive: true });
const server = spawn(process.execPath, ["server.js"], {
  env: {
    ...process.env,
    PORT: "32200",
    DATA_DIR: dir,
    REQUEST_LOG: "off",
    AUTO_BACKUP: "off",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
try {
  await new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
    server.once("exit", () => reject(Error("Tour server exited")));
  });
  browser = await chromium.launch({
    executablePath: process.env.SAKO_CHROMIUM || "/usr/bin/chromium",
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    colorScheme: "light",
  });
  await page.goto("http://127.0.0.1:32200/");
  await page.locator(".product").first().waitFor();
  await page.locator("#shop").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(frames, "frame-0.png") });
  await page
    .getByRole("button", { name: "View Dinorado details", exact: true })
    .click();
  await page.screenshot({ path: path.join(frames, "frame-1.png") });
  await page.getByLabel("Number of sacks").fill("10");
  await page
    .locator("#product-dialog")
    .getByRole("button", { name: "Add to bag" })
    .click();
  await page.screenshot({ path: path.join(frames, "frame-2.png") });
  await page
    .locator("#product-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.request.post("http://127.0.0.1:32200/api/auth/register", {
    data: {
      name: "Demo Wholesale Buyer",
      email: "tour@example.test",
      password: "tour-password-123",
    },
  });
  await page.reload();
  await page.locator("#cart-button").click();
  await page.getByLabel("Mobile number").fill("09123456789");
  await page.getByLabel("Receive your order").selectOption("pickup");
  await page.screenshot({ path: path.join(frames, "frame-3.png") });
  await page.getByRole("button", { name: "Place demo order" }).click();
  await page.locator("#success-receipt").waitFor();
  await page
    .locator("#cart-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.locator("#orders-link").click();
  await page.locator("#orders-content .order").waitFor();
  await page.screenshot({ path: path.join(frames, "frame-4.png") });
  console.log("Walkthrough frames:", frames);
} finally {
  if (browser) await browser.close();
  server.kill();
  await new Promise((resolve) => server.once("close", resolve));
  rmSync(dir, { recursive: true, force: true });
}
