import { test } from "node:test";
import assert from "node:assert/strict";
import { WindowLimiter } from "../services/security.js";
import { priceOrder } from "../services/pricing.js";
test("failed-attempt limits isolate accounts, clear on success, and expire", () => {
  let now = 1000;
  const limiter = new WindowLimiter(2, 100, () => now);
  limiter.hit("ip|alice");
  limiter.hit("ip|alice");
  assert.throws(
    () => limiter.check("ip|alice"),
    (e) => e.status === 429 && e.retryAfter > 0,
  );
  assert.doesNotThrow(() => limiter.check("ip|bob"));
  limiter.clear("ip|alice");
  assert.doesNotThrow(() => limiter.check("ip|alice"));
  limiter.hit("ip|alice");
  limiter.hit("ip|alice");
  now = 1101;
  assert.doesNotThrow(() => limiter.check("ip|alice"));
  limiter.prune();
  assert.equal(limiter.entries.size, 0);
});
test("integer-centavo tiers, cross-product quantities, delivery fees, and price floor", () => {
  const item = { id: 1, price: 1450, quantity: 9 };
  assert.equal(priceOrder([item], "pickup").total_centavos, 1305000);
  const ten = priceOrder([{ ...item, quantity: 10 }], "delivery", "tupi");
  assert.equal(ten.discount_centavos, 25000);
  assert.equal(ten.total_centavos, 1455000);
  const mixed = priceOrder(
    [
      { ...item, quantity: 20 },
      { id: 2, price: 1250, quantity: 5 },
    ],
    "delivery",
    "tantangan",
  );
  assert.equal(mixed.discount_centavos, 125000);
  assert.equal(mixed.delivery_fee_centavos, 25000);
  assert.equal(
    priceOrder([{ id: 1, price_centavos: 123456, quantity: 10 }], "pickup")
      .total_centavos,
    1209560,
  );
  assert.equal(
    priceOrder([{ id: 1, price: 10, quantity: 25 }], "pickup").total_centavos,
    2500,
  );
  assert.throws(() => priceOrder([item], "delivery", "unknown"));
});

test("JSON body preserves split UTF-8 chunks and enforces limits in bytes", async () => {
  const { Readable } = await import("node:stream");
  const { body } = await import("../services/http.js");
  const bytes = Buffer.from(JSON.stringify({ name: "José 🍚" }));
  const result = await body(
    Readable.from([...bytes].map((byte) => Buffer.from([byte]))),
  );
  assert.equal(result.name, "José 🍚");
  await assert.rejects(
    body(Readable.from([Buffer.from("ééé")]), 5),
    (error) => error.status === 413,
  );
});

test("backup script produces a consistent restorable SQL database and copies uploads", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { spawn } = await import("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sako-backup-test-"));
  const data = path.join(dir, "data"),
    destination = path.join(dir, "backups");
  fs.mkdirSync(path.join(data, "uploads"), { recursive: true });
  const db = new DatabaseSync(path.join(data, "sako.sqlite"));
  db.exec(
    "CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES('preserved')",
  );
  db.close();
  fs.writeFileSync(
    path.join(data, "uploads", "photo.txt"),
    "backup test fixture",
  );
  try {
    const child = spawn(process.execPath, ["scripts/backup.js"], {
      env: { ...process.env, DATA_DIR: data, BACKUP_DIR: destination },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let errors = "";
    child.stderr.on("data", (chunk) => (errors += chunk));
    const code = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(code, 0, errors);
    const folder = path.join(destination, fs.readdirSync(destination)[0]);
    const restored = new DatabaseSync(path.join(folder, "sako.sqlite"));
    assert.equal(
      restored.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    assert.equal(
      restored.prepare("SELECT value FROM proof").get().value,
      "preserved",
    );
    restored.close();
    assert.equal(
      fs.readFileSync(path.join(folder, "uploads", "photo.txt"), "utf8"),
      "backup test fixture",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
