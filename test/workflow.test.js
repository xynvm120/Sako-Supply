import { test } from "node:test";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
const root = process.cwd();
async function start(dir, port, password = "test-password", extraEnv = {}) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dir,
      ADMIN_PASSWORD: password,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (x) => (errors += x));
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("error", reject);
    child.once("exit", () => reject(Error("Server exited " + errors)));
  });
  return child;
}
async function stop(child) {
  child.kill();
  await new Promise((r) => child.once("close", r));
}
function client(port) {
  return async (url, method = "GET", data, cookie) => {
    const r = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    return {
      status: r.status,
      data: r.headers.get("content-type")?.includes("json")
        ? await r.json()
        : await r.text(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  };
}
test("wholesale customer and admin workflow", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sako-test-"));
  let child = await start(dir, 32187);
  const call = client(32187);
  let userCookie, adminCookie, otherCookie, product, orderId;
  try {
    await t.test(
      "catalog uses only 25 kg Philippine-market rice types",
      async () => {
        const r = await call("/api/products");
        assert.equal(r.status, 200);
        assert.equal(r.data.length, 5);
        assert.ok(
          r.data.every((p) => p.weight === 25 && p.description.length > 30),
        );
        product = r.data[0];
        assert.equal((await call("/")).status, 200);
      },
    );
    await t.test("registration, password hashing and login", async () => {
      const r = await call("/api/auth/register", "POST", {
        name: "Test Buyer",
        email: "buyer@example.test",
        password: "safe-password-123",
      });
      assert.equal(r.status, 201);
      userCookie = r.cookie;
      assert.equal(r.data.user.password_hash, undefined);
      assert.equal(
        (
          await call("/api/auth/register", "POST", {
            name: "Other Buyer",
            email: "other@example.test",
            password: "other-password",
          })
        ).status,
        201,
      );
      otherCookie = (
        await call("/api/auth/login", "POST", {
          email: "other@example.test",
          password: "other-password",
        })
      ).cookie;
      assert.equal(
        (
          await call("/api/auth/login", "POST", {
            email: "buyer@example.test",
            password: "incorrect",
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await call("/api/auth/register", "POST", {
            name: "Test",
            email: "buyer@example.test",
            password: "safe-password-123",
          })
        ).status,
        409,
      );
      assert.equal(
        (await call("/api/admin/orders", "GET", undefined, userCookie)).status,
        401,
      );
      assert.equal(
        (await call("/api/login", "POST", { password: "wrong" })).status,
        401,
      );
      adminCookie = (
        await call("/api/login", "POST", {
          email: "admin@sakosupply.com",
          password: "test-password",
        })
      ).cookie;
      const inspect = new DatabaseSync(path.join(dir, "sako.sqlite"));
      const user = inspect
        .prepare("SELECT * FROM users WHERE email=?")
        .get("buyer@example.test");
      assert.notEqual(user.password_hash, "safe-password-123");
      assert.equal(user.password_hash.length, 128);
      inspect.close();
    });
    const order = () => ({
      customer: "Test Buyer",
      phone: "09123456789",
      method: "delivery",
      address: "Sample local address",
      payment_method: "cash",
      items: [{ id: product.id, quantity: 5 }],
    });
    await t.test(
      "authorization and transactional checkout pricing",
      async () => {
        assert.equal((await call("/api/orders", "POST", order())).status, 401);
        const r = await call(
          "/api/orders",
          "POST",
          { ...order(), total: 1, price: 1 },
          userCookie,
        );
        assert.equal(r.status, 201);
        assert.equal(r.data.total, product.price * 5 + 150);
        assert.equal(r.data.payment_status, "Unpaid");
        orderId = r.data.id;
        assert.equal(
          (await call("/api/products")).data[0].stock,
          product.stock - 5,
        );
        assert.equal(
          (await call("/api/orders/" + orderId, "GET", undefined, otherCookie))
            .status,
          404,
        );
        assert.equal(
          (
            await call(
              "/api/orders/" + orderId + "/tracking",
              "GET",
              undefined,
              otherCookie,
            )
          ).status,
          404,
        );
        assert.equal(
          (await call("/api/orders", "GET", undefined, otherCookie)).data
            .length,
          0,
        );
        assert.equal(
          (await call("/api/orders", "GET", undefined, userCookie)).data.length,
          1,
        );
        assert.equal(
          (
            await call(
              "/api/orders",
              "POST",
              { ...order(), items: [{ id: product.id, quantity: 999 }] },
              userCookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              "/api/orders",
              "POST",
              {
                ...order(),
                items: [
                  { id: product.id, quantity: 1 },
                  { id: product.id, quantity: 1 },
                ],
              },
              userCookie,
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      "card and wallet simulations reject raw card data and failed payments",
      async () => {
        const before = (await call("/api/products")).data[0].stock;
        assert.equal(
          (
            await call(
              "/api/orders",
              "POST",
              {
                ...order(),
                payment_method: "card",
                cardNumber: "4242424242424242",
                demo_result: "success",
              },
              userCookie,
            )
          ).status,
          400,
        );
        for (const payment of ["card", "gcash", "maya"])
          assert.equal(
            (
              await call(
                "/api/orders",
                "POST",
                { ...order(), payment_method: payment, demo_result: "failure" },
                userCookie,
              )
            ).status,
            402,
          );
        assert.equal((await call("/api/products")).data[0].stock, before);
        for (const payment of ["card", "gcash", "maya"]) {
          const r = await call(
            "/api/orders",
            "POST",
            {
              ...order(),
              payment_method: payment,
              demo_result: "success",
              items: [{ id: product.id, quantity: 1 }],
            },
            userCookie,
          );
          assert.equal(r.status, 201);
          assert.equal(r.data.payment_status, "Demo paid");
          assert.equal(
            (
              await call(
                "/api/admin/status",
                "PATCH",
                { id: r.data.id, status: "Cancelled" },
                adminCookie,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await call(
                "/api/orders/" + r.data.id,
                "GET",
                undefined,
                userCookie,
              )
            ).data.payment_status,
            "Demo refunded",
          );
        }
        assert.equal((await call("/api/products")).data[0].stock, before);
      },
    );
    await t.test(
      "status transitions, payment collection and demo route",
      async () => {
        assert.equal(
          (
            await call(
              "/api/admin/status",
              "PATCH",
              { id: orderId, status: "Completed" },
              adminCookie,
            )
          ).status,
          400,
        );
        for (const status of ["Preparing", "Out for delivery"])
          assert.equal(
            (
              await call(
                "/api/admin/status",
                "PATCH",
                { id: orderId, status },
                adminCookie,
              )
            ).status,
            200,
          );
        const track = (
          await call(
            "/api/orders/" + orderId + "/tracking",
            "GET",
            undefined,
            userCookie,
          )
        ).data;
        assert.equal(track.demo, true);
        assert.equal(track.available, true);
        assert.ok(track.route.length > 2);
        assert.equal(
          (
            await call(
              "/api/admin/payment",
              "PATCH",
              { id: orderId },
              adminCookie,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await call(
              "/api/admin/status",
              "PATCH",
              { id: orderId, status: "Completed" },
              adminCookie,
            )
          ).status,
          200,
        );
        const completed = (
          await call("/api/orders/" + orderId, "GET", undefined, userCookie)
        ).data;
        assert.equal(completed.events.length, 4);
        assert.equal(completed.payment_status, "Paid");
        assert.equal(
          (
            await call(
              "/api/admin/status",
              "PATCH",
              { id: orderId, status: "Cancelled" },
              adminCookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              "/api/orders/" + orderId + "/tracking",
              "GET",
              undefined,
              userCookie,
            )
          ).data.progress,
          1,
        );
      },
    );
    await t.test("cancelled pickup restores inventory once", async () => {
      const before = (await call("/api/products")).data[0].stock;
      const r = await call(
        "/api/orders",
        "POST",
        { ...order(), method: "pickup" },
        userCookie,
      );
      assert.equal(r.data.total, product.price * 5);
      assert.equal(
        (
          await call(
            "/api/admin/status",
            "PATCH",
            { id: r.data.id, status: "Preparing" },
            adminCookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await call(
            "/api/admin/status",
            "PATCH",
            { id: r.data.id, status: "Out for delivery" },
            adminCookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            "/api/admin/status",
            "PATCH",
            { id: r.data.id, status: "Cancelled" },
            adminCookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await call(
            "/api/admin/status",
            "PATCH",
            { id: r.data.id, status: "Cancelled" },
            adminCookie,
          )
        ).status,
        400,
      );
      assert.equal((await call("/api/products")).data[0].stock, before);
    });
    await t.test(
      "inventory audit trail, product management, reports and customer history",
      async () => {
        assert.equal(
          (
            await call(
              "/api/admin/stock",
              "PATCH",
              { id: product.id, delta: 5 },
              adminCookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              "/api/admin/stock",
              "PATCH",
              { id: product.id, delta: -10000, reason: "Bad adjustment" },
              adminCookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              "/api/admin/stock",
              "PATCH",
              { id: product.id, delta: 20, reason: "Supplier delivery" },
              adminCookie,
            )
          ).status,
          200,
        );
        const data = (
          await call("/api/admin/products", "GET", undefined, adminCookie)
        ).data;
        assert.equal(data.movements[0].reason, "Supplier delivery");
        const draft = {
          name: "Sample Philippine rice",
          variety: "Sample",
          price: 1200,
          tag: "Everyday",
          description: "Supplier-confirmed sample description",
          texture: "Soft",
          cooking: "Follow sack instructions",
        };
        const added = await call(
          "/api/admin/products",
          "POST",
          draft,
          adminCookie,
        );
        assert.equal(added.status, 201);
        assert.equal(
          (
            await call(
              "/api/admin/products",
              "PATCH",
              { ...draft, id: added.data.id, active: false },
              adminCookie,
            )
          ).status,
          200,
        );
        assert.equal((await call("/api/products")).data.length, 5);
        const report = (
          await call("/api/admin/reports", "GET", undefined, adminCookie)
        ).data;
        assert.equal(report.orders.length, 1);
        assert.equal(report.total, product.price * 5 + 150);
        assert.equal(report.bestSellers[0].sacks, 5);
        const csv = await call(
          "/api/admin/reports?format=csv",
          "GET",
          undefined,
          adminCookie,
        );
        assert.ok(csv.data.includes(orderId));
        assert.equal(
          (
            await call(
              "/api/admin/reports?from=2026-12-31&to=2026-01-01",
              "GET",
              undefined,
              adminCookie,
            )
          ).status,
          400,
        );
        const customers = (
          await call("/api/admin/customers", "GET", undefined, adminCookie)
        ).data;
        assert.equal(customers.length, 2);
        assert.ok(
          customers.find((c) => c.email === "buyer@example.test").order_count >
            0,
        );
        assert.equal(
          (await call("/api/admin/reports", "GET", undefined, userCookie))
            .status,
          401,
        );
      },
    );
    await t.test(
      "product photos validate file content and require admin access",
      async () => {
        const png =
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ioAAAAASUVORK5CYII=";
        assert.equal(
          (
            await call(
              "/api/admin/image",
              "POST",
              { id: product.id, data: png },
              userCookie,
            )
          ).status,
          401,
        );
        assert.equal(
          (
            await call(
              "/api/admin/image",
              "POST",
              { id: product.id, data: "data:image/png;base64,PHNjcmlwdD4=" },
              adminCookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              "/api/admin/image",
              "POST",
              { id: product.id, data: png },
              adminCookie,
            )
          ).status,
          200,
        );
        const updated = (await call("/api/products")).data.find(
          (p) => p.id === product.id,
        );
        assert.ok(updated.image.startsWith("/media/"));
        assert.equal(
          (await fetch("http://127.0.0.1:32187" + updated.image)).status,
          200,
        );
        assert.equal(
          (
            await call(
              "/api/admin/image",
              "POST",
              { id: product.id, remove: true },
              adminCookie,
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      "sessions, account profile, and orders survive server restart; logout revokes access",
      async () => {
        assert.equal(
          (
            await call(
              "/api/profile",
              "PATCH",
              {
                name: "Buyer Updated",
                phone: "09123456789",
                address: "Saved address",
              },
              userCookie,
            )
          ).status,
          200,
        );
        await stop(child);
        child = await start(dir, 32187);
        assert.equal(
          (await call("/api/session", "GET", undefined, userCookie)).data.user
            .name,
          "Buyer Updated",
        );
        assert.equal(
          (await call("/api/orders/" + orderId, "GET", undefined, userCookie))
            .data.status,
          "Completed",
        );
        await call("/api/logout", "POST", {}, userCookie);
        assert.equal(
          (await call("/api/orders", "GET", undefined, userCookie)).status,
          401,
        );
        await call("/api/logout", "POST", {}, adminCookie);
        assert.equal(
          (await call("/api/admin/orders", "GET", undefined, adminCookie))
            .status,
          401,
        );
      },
    );
    await t.test(
      "CSP, health, admin audit and collections report",
      async () => {
        const response = await fetch("http://127.0.0.1:32187/");
        assert.ok(
          response.headers
            .get("content-security-policy")
            .includes("script-src 'self'"),
        );
        assert.equal((await call("/health")).data.status, "ok");
        const logged = await call("/api/login", "POST", {
          email: "admin@sakosupply.com",
          password: "test-password",
        });
        const audit = (
          await call("/api/admin/audit", "GET", undefined, logged.cookie)
        ).data;
        assert.ok(audit.some((row) => row.actor === "admin@sakosupply.com"));
        const report = (
          await call("/api/admin/reports", "GET", undefined, logged.cookie)
        ).data;
        assert.equal(report.collectedCash, product.price * 5 + 150);
      },
    );
  } finally {
    await stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy database migration preserves historical five-kilogram orders", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sako-legacy-"));
  const legacy = new DatabaseSync(path.join(dir, "sako.sqlite"));
  legacy.exec(
    "CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,variety TEXT,weight INTEGER,price INTEGER,stock INTEGER,tag TEXT); CREATE TABLE orders(id TEXT PRIMARY KEY,customer TEXT,phone TEXT,address TEXT,method TEXT,status TEXT,total INTEGER,created TEXT,items TEXT);",
  );
  legacy
    .prepare("INSERT INTO products VALUES(1,?,?,?,?,?,?)")
    .run("Dinorado", "Legacy product", 5, 310, 20, "Bestseller");
  legacy
    .prepare("INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?)")
    .run(
      "LEGACY",
      "Old Customer",
      "09123456789",
      "",
      "pickup",
      "Completed",
      310,
      new Date().toISOString(),
      JSON.stringify([
        { id: 1, name: "Dinorado", weight: 5, price: 310, quantity: 1 },
      ]),
    );
  legacy.close();
  const child = await start(dir, 32188);
  try {
    const call = client(32188);
    assert.ok((await call("/api/products")).data.every((p) => p.weight === 25));
    const admin = (
      await call("/api/login", "POST", {
        email: "admin@sakosupply.com",
        password: "test-password",
      })
    ).cookie;
    const orders = (await call("/api/admin/orders", "GET", undefined, admin))
      .data;
    assert.equal(orders[0].items[0].weight, 5);
    assert.equal(orders[0].total, 310);
  } finally {
    await stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("default admin signs in through shared email/password login", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sako-admin-"));
  const child = await start(dir, 32190, "");
  const call = client(32190);
  try {
    assert.equal(
      (
        await call("/api/auth/register", "POST", {
          name: "Fake Admin",
          email: "admin@sakosupply.com",
          password: "different-pass",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call("/api/auth/login", "POST", {
          email: "admin@sakosupply.com",
          password: "incorrect",
        })
      ).status,
      401,
    );
    const login = await call("/api/auth/login", "POST", {
      email: "ADMIN@SAKOSUPPLY.COM",
      password: "admin123",
    });
    assert.equal(login.status, 200);
    assert.equal(login.data.admin, true);
    assert.equal(
      (await call("/api/admin/orders", "GET", undefined, login.cookie)).status,
      200,
    );
    assert.equal(
      (await call("/api/orders", "GET", undefined, login.cookie)).status,
      401,
    );
    assert.equal(
      (await call("/api/login", "POST", { password: "admin123" })).status,
      401,
    );
  } finally {
    await stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("failed login rate limiter and successful attempts are distinguished", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sako-limits-"));
  const child = await start(dir, 32191);
  const call = client(32191);
  try {
    for (let i = 0; i < 10; i++)
      assert.equal(
        (
          await call("/api/login", "POST", {
            email: "admin@sakosupply.com",
            password: "test-password",
          })
        ).status,
        200,
      );
    for (let i = 0; i < 8; i++)
      assert.equal(
        (
          await call("/api/login", "POST", {
            email: "admin@sakosupply.com",
            password: "bad",
          })
        ).status,
        401,
      );
    const blocked = await fetch("http://127.0.0.1:32191/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@sakosupply.com", password: "bad" }),
    });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.equal(
      (
        await call("/api/auth/login", "POST", {
          email: "other@example.test",
          password: "different",
        })
      ).status,
      401,
    );
    const buyer = await call("/api/auth/register", "POST", {
      name: "Limit Buyer",
      email: "limit-buyer@example.test",
      password: "limit-buyer-password",
    });
    for (let i = 0; i < 20; i++)
      assert.equal(
        (
          await call(
            "/api/orders",
            "POST",
            {
              customer: "Limit Buyer",
              phone: "09123456789",
              method: "pickup",
              payment_method: "cash",
              items: [],
            },
            buyer.cookie,
          )
        ).status,
        400,
      );
    assert.equal(
      (
        await call(
          "/api/orders",
          "POST",
          {
            customer: "Limit Buyer",
            phone: "09123456789",
            method: "pickup",
            payment_method: "cash",
            items: [],
          },
          buyer.cookie,
        )
      ).status,
      429,
    );
  } finally {
    await stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});
test("parallel servers cannot sell the last sack twice; expiry, zones, cancellation, and SQL guards", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sako-race-"));
  let first = await start(dir, 32192);
  const second = await start(dir, 32193);
  const a = client(32192),
    b = client(32193);
  try {
    const user = await a("/api/auth/register", "POST", {
      name: "Race Buyer",
      email: "race@example.test",
      password: "safe-race-password",
    });
    const admin = await a("/api/login", "POST", {
      email: "admin@sakosupply.com",
      password: "test-password",
    });
    const product = (await a("/api/products")).data[0];
    await a(
      "/api/admin/stock",
      "PATCH",
      {
        id: product.id,
        delta: 1 - product.stock,
        reason: "Race test last sack",
      },
      admin.cookie,
    );
    const request = {
      customer: "Race Buyer",
      phone: "09123456789",
      method: "pickup",
      payment_method: "cash",
      items: [{ id: product.id, quantity: 1 }],
    };
    const results = await Promise.all([
      a("/api/orders", "POST", request, user.cookie),
      b("/api/orders", "POST", request, user.cookie),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 400]);
    assert.equal((await a("/api/products")).data[0].stock, 0);
    const winner = results.find((r) => r.status === 201);
    assert.equal(
      (
        await a(
          "/api/orders/" + winner.data.id + "/cancel",
          "POST",
          {},
          user.cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await a(
          "/api/orders/" + winner.data.id + "/cancel",
          "POST",
          {},
          user.cookie,
        )
      ).status,
      400,
    );
    assert.equal((await a("/api/products")).data[0].stock, 1);
    await a(
      "/api/admin/stock",
      "PATCH",
      { id: product.id, delta: 30, reason: "Bulk test supply" },
      admin.cookie,
    );
    const bulk = await a(
      "/api/orders",
      "POST",
      {
        ...request,
        method: "delivery",
        address: "Demo address",
        delivery_zone: "tupi",
        items: [{ id: product.id, quantity: 10 }],
      },
      user.cookie,
    );
    assert.equal(bulk.data.discount_centavos, 25000);
    assert.equal(
      bulk.data.items[0].original_price_centavos,
      product.price * 100,
    );
    assert.equal(
      bulk.data.items[0].unit_price_centavos,
      (product.price - 25) * 100,
    );
    assert.equal(bulk.data.total, (product.price - 25) * 10 + 300);
    assert.equal(
      (
        await a(
          "/api/orders",
          "POST",
          {
            ...request,
            method: "delivery",
            address: "Demo address",
            delivery_zone: "invalid",
          },
          user.cookie,
        )
      ).status,
      400,
    );
    const notes = (await a("/api/notifications", "GET", undefined, user.cookie))
      .data;
    assert.ok(notes.length >= 3);
    const inspect = new DatabaseSync(path.join(dir, "sako.sqlite"));
    assert.throws(() =>
      inspect
        .prepare("UPDATE products SET stock=-1 WHERE id=?")
        .run(product.id),
    );
    inspect
      .prepare("UPDATE sessions SET expires=0 WHERE role='customer'")
      .run();
    assert.equal(
      (await a("/api/orders", "GET", undefined, user.cookie)).status,
      401,
    );
    inspect.close();
    await stop(first);
    first = await start(dir, 32192);
    const after = new DatabaseSync(path.join(dir, "sako.sqlite"));
    assert.equal(
      after.prepare("SELECT count(*) n FROM sessions WHERE expires=0").get().n,
      0,
    );
    after.close();
  } finally {
    await stop(first);
    await stop(second);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("admin-assisted recovery requires authorization, expires, is single-use and revokes sessions", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sako-recovery-"));
  const child = await start(dir,32192);
  const call=client(32192);
  try {
    const account=await call('/api/auth/register','POST',{name:'Recovery buyer',email:'reset@example.test',password:'old-password-123'});
    const admin=await call('/api/auth/login','POST',{email:'admin@sakosupply.com',password:'test-password'});
    const issue={email:'reset@example.test',identity_verified:true};
    assert.equal((await call('/api/auth/recovery-code','POST',issue)).status,401);
    assert.equal((await call('/api/auth/recovery-code','POST',issue,account.cookie)).status,401);
    assert.equal((await call('/api/auth/recovery-code','POST',{email:issue.email},admin.cookie)).status,400);
    const first=await call('/api/auth/recovery-code','POST',issue,admin.cookie);
    const second=await call('/api/auth/recovery-code','POST',issue,admin.cookie);
    const reset={email:issue.email,code:first.data.code,password:'new-password-123'};
    assert.equal((await call('/api/auth/reset-password','POST',reset)).status,400);
    const sql=new DatabaseSync(path.join(dir,'sako.sqlite'));
    const row=sql.prepare('SELECT * FROM password_resets').get();
    assert.notEqual(row.token_hash,second.data.code);
    sql.prepare('UPDATE password_resets SET expires=0').run();
    reset.code=second.data.code;
    assert.equal((await call('/api/auth/reset-password','POST',reset)).status,400);
    reset.code=(await call('/api/auth/recovery-code','POST',issue,admin.cookie)).data.code;
    assert.equal((await call('/api/auth/reset-password','POST',reset)).status,200);
    assert.equal((await call('/api/auth/reset-password','POST',reset)).status,400);
    assert.equal((await call('/api/session','GET',undefined,account.cookie)).data.user,null);
    assert.equal((await call('/api/auth/login','POST',{email:issue.email,password:'old-password-123'})).status,401);
    assert.equal((await call('/api/auth/login','POST',{email:issue.email,password:reset.password})).status,200);
    assert.equal(sql.prepare('SELECT count(*) n FROM password_resets').get().n,0);
    sql.close();
    assert.equal((await call('/privacy.html')).status,200);
    assert.equal((await call('/agreement.html')).status,200);
  } finally { await stop(child); rmSync(dir,{recursive:true,force:true}); }
});

test("verified email delivery, opaque recovery, one-use links, expiry and provider failure", async () => {
  const messages=[];
  let rejectMail=false;
  const provider=createServer(async(req,res)=>{
    let data=''; for await (const chunk of req) data+=chunk;
    assert.equal(req.headers.authorization,'Bearer test-mail-key');
    if(rejectMail) { res.writeHead(503); return res.end('{}'); }
    messages.push(JSON.parse(data));
    res.writeHead(200,{'Content-Type':'application/json'});res.end('{"id":"test-message"}');
  });
  await new Promise(resolve=>provider.listen(32194,'127.0.0.1',resolve));
  const dir=mkdtempSync(path.join(os.tmpdir(),'sako-email-'));
  const child=await start(dir,32193,'test-password',{
    EMAIL_API_KEY:'test-mail-key',EMAIL_FROM:'Sako <test@example.test>',
    EMAIL_API_URL:'http://127.0.0.1:32194/emails',PUBLIC_URL:'http://localhost:3000',SUPPORT_EMAIL:'help@example.test'
  });
  const call=client(32193);
  const codeOf=mail=>new URL(mail.text.split('\n')[1]).hash.slice(1);
  try {
    const created=await call('/api/auth/register','POST',{name:'Email buyer',email:'mail@example.test',password:'old-password-123'});
    assert.equal(created.data.user.email_verified,false);
    assert.equal((await call('/api/config')).data.emailRecovery,true);
    assert.equal((await call('/api/config')).data.supportEmail,'help@example.test');
    assert.equal((await call('/api/auth/request-verification','POST',{})).status,401);
    const unknown=await call('/api/auth/forgot-password','POST',{email:'unknown@example.test'});
    const unverified=await call('/api/auth/forgot-password','POST',{email:'mail@example.test'});
    assert.deepEqual(unknown.data,unverified.data);
    assert.equal(messages.length,0);
    assert.equal((await call('/api/auth/request-verification','POST',{},created.cookie)).status,200);
    assert.equal(messages.length,1);
    const params=new URLSearchParams(codeOf(messages[0]));
    assert.equal(params.get('flow'),'verify');
    const verify={email:'mail@example.test',code:params.get('code')};
    assert.equal((await call('/api/auth/verify-email','POST',{...verify,email:'other@example.test'})).status,400);
    assert.equal((await call('/api/auth/verify-email','POST',verify)).status,200);
    assert.equal((await call('/api/auth/verify-email','POST',verify)).status,400);
    assert.equal((await call('/api/session','GET',undefined,created.cookie)).data.user.email_verified,true);
    const recovery=await call('/api/auth/forgot-password','POST',{email:'mail@example.test'});
    assert.deepEqual(recovery.data,unknown.data);
    assert.equal(messages.length,2);
    const resetParams=new URLSearchParams(codeOf(messages[1]));
    assert.equal(resetParams.get('flow'),'recover');
    const reset={email:resetParams.get('email'),code:resetParams.get('code'),password:'new-password-123'};
    assert.equal((await call('/api/auth/reset-password','POST',reset)).status,200);
    assert.equal((await call('/api/auth/reset-password','POST',reset)).status,400);
    assert.equal((await call('/api/session','GET',undefined,created.cookie)).data.user,null);
    assert.equal((await call('/api/auth/forgot-password','POST',{email:'mail@example.test'})).status,429);
    const other=await call('/api/auth/register','POST',{name:'Other',email:'expiry@example.test',password:'safe-password-123'});
    await call('/api/auth/request-verification','POST',{},other.cookie);
    const expired=new URLSearchParams(codeOf(messages.at(-1)));
    const sql=new DatabaseSync(path.join(dir,'sako.sqlite'));
    sql.prepare('UPDATE email_verifications SET expires=0').run();
    assert.equal((await call('/api/auth/verify-email','POST',{email:'expiry@example.test',code:expired.get('code')})).status,400);
    rejectMail=true;
    assert.equal((await call('/api/auth/request-verification','POST',{},other.cookie)).status,503);
    assert.equal(sql.prepare('SELECT count(*) n FROM email_verifications').get().n,0);
    sql.close();
    assert.equal((await call('/help.html')).status,200);
    assert.equal((await call('/returns.html')).status,200);
  } finally {
    await stop(child); await new Promise(resolve=>provider.close(resolve)); rmSync(dir,{recursive:true,force:true});
  }
});
