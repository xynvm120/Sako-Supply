import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  randomBytes,
  timingSafeEqual,
  scrypt as scryptCallback,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(fileURLToPath(import.meta.url));
const scrypt = promisify(scryptCallback);
const dataDir = process.env.DATA_DIR || path.join(root, "data");
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, "sako.sqlite"));
db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
db.exec(readFileSync(path.join(root, "db/schema.sql"), "utf8"));
function column(table, name, definition) {
  if (
    !db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .some((c) => c.name === name)
  )
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}
for (const [name, definition] of [
  ["description", "TEXT NOT NULL DEFAULT ''"],
  ["texture", "TEXT NOT NULL DEFAULT ''"],
  ["cooking", "TEXT NOT NULL DEFAULT ''"],
  ["active", "INTEGER NOT NULL DEFAULT 1"],
  ["image", "TEXT NOT NULL DEFAULT ''"],
])
  column("products", name, definition);
for (const [name, definition] of [
  ["user_id", "TEXT REFERENCES users(id)"],
  ["payment_method", "TEXT NOT NULL DEFAULT 'cash'"],
  ["payment_status", "TEXT NOT NULL DEFAULT 'Unpaid'"],
  ["delivery_fee", "INTEGER NOT NULL DEFAULT 0"],
  ["dispatch_at", "TEXT"],
])
  column("orders", name, definition);
db.exec("CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);");
if (!db.prepare("SELECT count(*) n FROM products").get().n) {
  const insert = db.prepare(
    "INSERT INTO products(id,name,variety,weight,price,stock,tag) VALUES(?,?,?,?,?,?,?)",
  );
  for (const p of [
    [1, "Dinorado", "Fragrant rice", 25, 1450, 60, "Premium"],
    [2, "Jasmine", "Soft & aromatic", 25, 1390, 55, "Premium"],
    [3, "Sinandomeng", "Everyday family favorite", 25, 1250, 80, "Everyday"],
    [
      4,
      "Well-milled white rice",
      "Versatile everyday staple",
      25,
      1120,
      100,
      "Value",
    ],
    [5, "Brown rice", "Whole grain goodness", 25, 1950, 30, "Whole grain"],
  ])
    insert.run(...p);
}
// Retain old 5 kg rows and historical orders; archive them from the wholesale catalog.
db.prepare("UPDATE products SET active=0 WHERE weight<>25").run();
if (
  !db
    .prepare("SELECT id FROM products WHERE name='Brown rice' AND weight=25")
    .get()
)
  db.prepare(
    "INSERT INTO products(name,variety,weight,price,stock,tag) VALUES(?,?,?,?,?,?)",
  ).run("Brown rice", "Whole grain goodness", 25, 1950, 30, "Whole grain");
const descriptions = {
  Dinorado: [
    "A fragrant white rice market type commonly sold by Philippine rice retailers. A comforting choice for family meals, food stalls, and catering. This sample listing is not a certified cultivar or origin claim.",
    "Tender and slightly sticky when cooked.",
    "Rinse before cooking. Start with the water ratio on your supplier’s sack and adjust to your rice cooker.",
  ],
  Jasmine: [
    "Aromatic long-grain rice sold in the Philippine market. A popular companion to grilled dishes, stir-fries, and everyday ulam. Supplier and country of origin vary.",
    "Soft grains with a delicate aroma.",
    "Rinse gently; follow the package water ratio and allow to rest after cooking.",
  ],
  Sinandomeng: [
    "A familiar Philippine rice retail name used for everyday white rice. A practical option for households and bulk food preparation. Characteristics may vary by supplier and batch.",
    "Mild flavor with soft, fluffy grains.",
    "Rinse and use your supplier’s recommended rice-to-water ratio.",
  ],
  "Well-milled white rice": [
    "White rice classified by milling level rather than a commercial brand or a specific variety. A common, versatile staple in Philippine rice shops.",
    "Mild-tasting white rice; texture varies by variety.",
    "Rinse and cook according to the supplier’s package instructions.",
  ],
  "Well-milled": [
    "White rice classified by milling level. Widely sold by Philippine rice retailers; not a specific brand or cultivar.",
    "Mild flavor; texture varies by variety.",
    "Follow the supplier’s package instructions.",
  ],
  "Brown rice": [
    "Whole-grain rice retaining its bran layer, sold in Philippine supermarkets and rice shops. A distinct option for customers who enjoy a firmer grain.",
    "Nutty flavor and a chewy, firmer texture.",
    "Usually needs more water and cooking time than white rice. Follow the sack instructions.",
  ],
};
for (const p of db
  .prepare("SELECT * FROM products WHERE description=''")
  .all()) {
  const d = descriptions[p.name] || [
    "Rice available from local suppliers. Verify specifications before purchasing.",
    "Varies by supplier.",
    "Follow package instructions.",
  ];
  db.prepare(
    "UPDATE products SET description=?,texture=?,cooking=? WHERE id=?",
  ).run(...d, p.id);
}
// Normalize existing order snapshots without discarding history.
for (const o of db
  .prepare(
    "SELECT * FROM orders WHERE NOT EXISTS(SELECT 1 FROM order_items WHERE order_id=orders.id)",
  )
  .all()) {
  const insert = db.prepare(
    "INSERT INTO order_items(order_id,product_id,name,weight,price,quantity) VALUES(?,?,?,?,?,?)",
  );
  for (const i of JSON.parse(o.items || "[]"))
    insert.run(o.id, i.id, i.name, i.weight, i.price, i.quantity);
}
for (const o of db
  .prepare("SELECT * FROM orders WHERE method='delivery' AND delivery_fee=0")
  .all()) {
  const sub = JSON.parse(o.items || "[]").reduce(
    (sum, i) => sum + i.price * i.quantity,
    0,
  );
  db.prepare("UPDATE orders SET delivery_fee=? WHERE id=?").run(
    Math.max(0, o.total - sub),
    o.id,
  );
}
const now = () => new Date().toISOString();
const str = (x, max = 150) =>
  typeof x === "string" ? x.trim().slice(0, max) : "";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const safe = (a, b) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const fail = (status, message) => Object.assign(Error(message), { status });
const transaction = (f) => {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = f();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
};
const adminEmail = (process.env.ADMIN_EMAIL || "admin@sakosupply.com")
  .trim()
  .toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
const publicUser = (u) =>
  u
    ? {
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        address: u.address,
      }
    : null;
const minSacks = 1; // Wholesale catalog; no invented minimum purchase requirement.
const deliveryFee = 150;
const defaultProductImages = {
  Dinorado: "dinorado",
  Jasmine: "jasmine",
  Sinandomeng: "sinandomeng",
  "Well-milled white rice": "well-milled",
  "Well-milled": "well-milled",
  "Brown rice": "brown-rice",
};
const allProducts = (archived = false) =>
  db
    .prepare(
      `SELECT * FROM products ${archived ? "" : "WHERE active=1 AND weight=25"} ORDER BY id`,
    )
    .all()
    .map((product) => ({
      ...product,
      default_image: defaultProductImages[product.name]
        ? `/assets/products/${defaultProductImages[product.name]}.png`
        : "",
    }));
function session(req) {
  const token = (req.headers.cookie || "")
    .split(/;\s*/)
    .find((v) => v.startsWith("sako_session="))
    ?.slice(13);
  if (!token) return null;
  return db
    .prepare("SELECT * FROM sessions WHERE token_hash=? AND expires>?")
    .get(hash(token), Date.now());
}
function requireAdmin(req) {
  const s = session(req);
  if (s?.role !== "admin") throw fail(401, "Admin sign-in required.");
  return s;
}
function requireCustomer(req) {
  const s = session(req);
  if (s?.role !== "customer")
    throw fail(401, "Sign in to your customer account first.");
  return s;
}
function setSession(res, userId, role) {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
    hash(token),
    userId,
    role,
    Date.now() + 86400000,
  );
  res.setHeader(
    "Set-Cookie",
    `sako_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
}
function revoke(req) {
  const s = session(req);
  if (s)
    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(s.token_hash);
}
function orderDTO(o) {
  return {
    ...o,
    items: db
      .prepare(
        "SELECT product_id AS id,name,weight,price,quantity FROM order_items WHERE order_id=?",
      )
      .all(o.id),
    events: db
      .prepare(
        "SELECT status,created FROM order_events WHERE order_id=? ORDER BY id",
      )
      .all(o.id),
    demo: true,
  };
}
function nextStatuses(o) {
  return (
    {
      Pending: ["Preparing", "Cancelled"],
      Preparing: [
        o.method === "delivery" ? "Out for delivery" : "Ready for pickup",
        "Cancelled",
      ],
      Ready: ["Completed", "Cancelled"],
      "Ready for pickup": ["Completed", "Cancelled"],
      "Out for delivery": ["Completed", "Cancelled"],
      Completed: [],
      Cancelled: [],
    }[o.status] || []
  );
}
const attempts = new Map();
function rateLimit(req) {
  const key = req.socket.remoteAddress;
  const value = attempts.get(key);
  if (!value || value.reset < Date.now()) {
    attempts.set(key, { n: 1, reset: Date.now() + 600000 });
    return;
  }
  if (++value.n > 40)
    throw fail(
      429,
      "Too many sign-in attempts. Please try again in 10 minutes.",
    );
}
async function body(req, limit = 40000) {
  let data = "";
  for await (const c of req) {
    data += c;
    if (data.length > limit) throw fail(413, "Request too large.");
  }
  try {
    return JSON.parse(data || "{}");
  } catch {
    throw fail(400, "Invalid JSON request.");
  }
}
function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  try {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    const method = req.method;
    if (
      ["POST", "PATCH", "DELETE", "PUT"].includes(method) &&
      req.headers.origin &&
      req.headers.origin !== `http://${req.headers.host}` &&
      req.headers.origin !== `https://${req.headers.host}`
    )
      throw fail(403, "Cross-site request rejected.");
    if (p === "/api/config" && method === "GET")
      return send(res, 200, {
        demo: true,
        weight: 25,
        minSacks,
        deliveryFee,
        paymentMethods: ["cash", "card", "gcash", "maya"],
      });
    if (p === "/api/products" && method === "GET")
      return send(res, 200, allProducts());
    if (p === "/api/session" && method === "GET") {
      const s = session(req);
      return send(res, 200, {
        admin: s?.role === "admin",
        user: s?.user_id
          ? publicUser(
              db.prepare("SELECT * FROM users WHERE id=?").get(s.user_id),
            )
          : null,
      });
    }
    if (p === "/api/auth/register" && method === "POST") {
      rateLimit(req);
      const b = await body(req);
      const name = str(b.name),
        email = str(b.email, 254).toLowerCase(),
        password = b.password;
      if (
        !name ||
        !/^\S+@\S+\.\S+$/.test(email) ||
        typeof password !== "string" ||
        password.length < 8 ||
        password.length > 128
      )
        throw fail(
          400,
          "Enter your name, a valid email, and a password of 8–128 characters.",
        );
      if (
        email === adminEmail ||
        db.prepare("SELECT id FROM users WHERE email=?").get(email)
      )
        throw fail(409, "An account already uses that email. Sign in instead.");
      const salt = randomBytes(16).toString("hex"),
        derived = (await scrypt(password, salt, 64)).toString("hex");
      const id = randomBytes(12).toString("hex");
      try {
        db.prepare(
          "INSERT INTO users(id,name,email,password_hash,salt,created) VALUES(?,?,?,?,?,?)",
        ).run(id, name, email, derived, salt, now());
      } catch (e) {
        if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
          throw fail(409, "An account already uses that email.");
        throw e;
      }
      revoke(req);
      setSession(res, id, "customer");
      return send(res, 201, {
        user: publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id)),
      });
    }
    if (["/api/auth/login", "/api/login"].includes(p) && method === "POST") {
      rateLimit(req);
      const b = await body(req),
        email = str(b.email, 254).toLowerCase();
      if (typeof b.password !== "string" || b.password.length > 128)
        throw fail(401, "Incorrect email or password.");
      if (email === adminEmail) {
        if (!safe(b.password, adminPassword))
          throw fail(401, "Incorrect email or password.");
        revoke(req);
        setSession(res, null, "admin");
        return send(res, 200, { admin: true, user: null });
      }
      const u = db.prepare("SELECT * FROM users WHERE email=?").get(email);
      const derived = (
        await scrypt(b.password, u?.salt || "missing-user-timing-salt", 64)
      ).toString("hex");
      if (!u || !safe(derived, u.password_hash))
        throw fail(401, "Incorrect email or password.");
      revoke(req);
      setSession(res, u.id, "customer");
      return send(res, 200, { user: publicUser(u) });
    }
    if (p === "/api/logout" && method === "POST") {
      revoke(req);
      res.setHeader(
        "Set-Cookie",
        "sako_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      );
      return send(res, 200, { ok: true });
    }
    if (p === "/api/profile" && method === "PATCH") {
      const s = requireCustomer(req),
        b = await body(req);
      const name = str(b.name),
        phone = str(b.phone, 30),
        address = str(b.address, 500);
      if (!name || !/^\+?[\d\s-]{10,16}$/.test(phone))
        throw fail(400, "Enter a name and valid mobile number.");
      db.prepare("UPDATE users SET name=?,phone=?,address=? WHERE id=?").run(
        name,
        phone,
        address,
        s.user_id,
      );
      return send(res, 200, {
        user: publicUser(
          db.prepare("SELECT * FROM users WHERE id=?").get(s.user_id),
        ),
      });
    }
    if (p === "/api/orders" && method === "GET") {
      const s = requireCustomer(req);
      return send(
        res,
        200,
        db
          .prepare("SELECT * FROM orders WHERE user_id=? ORDER BY created DESC")
          .all(s.user_id)
          .map(orderDTO),
      );
    }
    if (p === "/api/orders" && method === "POST") {
      const s = requireCustomer(req),
        b = await body(req);
      if (
        ["cardNumber", "card_number", "cvc", "cvv", "expiry"].some(
          (k) => k in b,
        )
      )
        throw fail(
          400,
          "Never send card details to this server. Use the demo payment controls.",
        );
      const customer = str(b.customer),
        phone = str(b.phone, 30),
        address = str(b.address, 500);
      if (
        !customer ||
        !/^\+?[\d\s-]{10,16}$/.test(phone) ||
        !["pickup", "delivery"].includes(b.method) ||
        (b.method === "delivery" && !address)
      )
        throw fail(
          400,
          "Enter your name, valid mobile number, and delivery address if required.",
        );
      if (!["cash", "card", "gcash", "maya"].includes(b.payment_method))
        throw fail(400, "Select a payment method.");
      if (!Array.isArray(b.items) || !b.items.length || b.items.length > 100)
        throw fail(400, "Add at least one sack to your order.");
      if (
        b.payment_method !== "cash" &&
        !["success", "failure"].includes(b.demo_result)
      )
        throw fail(400, "Choose a demo payment outcome.");
      if (b.payment_method !== "cash" && b.demo_result === "failure")
        throw fail(
          402,
          "Demo payment declined. No order was created and no stock was reserved.",
        );
      const result = transaction(() => {
        let subtotal = 0;
        const items = [],
          seen = new Set();
        for (const i of b.items) {
          const product = db
            .prepare(
              "SELECT * FROM products WHERE id=? AND active=1 AND weight=25",
            )
            .get(Number(i.id));
          if (
            !product ||
            seen.has(product.id) ||
            !Number.isInteger(i.quantity) ||
            i.quantity < 1 ||
            i.quantity > product.stock
          )
            throw fail(
              400,
              "An item is unavailable or exceeds stock. Refresh your bag.",
            );
          seen.add(product.id);
          items.push({ ...product, quantity: i.quantity });
          subtotal += product.price * i.quantity;
        }
        const fee = b.method === "delivery" ? deliveryFee : 0,
          total = subtotal + fee;
        if (total > 100000000)
          throw fail(400, "Order exceeds the demo transaction limit.");
        const id = "SK-" + randomBytes(5).toString("hex").toUpperCase(),
          created = now();
        const paymentStatus =
          b.payment_method === "cash" ? "Unpaid" : "Demo paid";
        db.prepare(
          "INSERT INTO orders(id,customer,phone,address,method,status,total,created,items,user_id,payment_method,payment_status,delivery_fee) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          id,
          customer,
          phone,
          address,
          b.method,
          "Pending",
          total,
          created,
          JSON.stringify(
            items.map((i) => ({
              id: i.id,
              name: i.name,
              weight: i.weight,
              price: i.price,
              quantity: i.quantity,
            })),
          ),
          s.user_id,
          b.payment_method,
          paymentStatus,
          fee,
        );
        for (const i of items) {
          db.prepare("UPDATE products SET stock=stock-? WHERE id=?").run(
            i.quantity,
            i.id,
          );
          db.prepare(
            "INSERT INTO order_items(order_id,product_id,name,weight,price,quantity) VALUES(?,?,?,?,?,?)",
          ).run(id, i.id, i.name, i.weight, i.price, i.quantity);
          db.prepare(
            "INSERT INTO stock_movements(product_id,delta,reason,created) VALUES(?,?,?,?)",
          ).run(i.id, -i.quantity, `Order ${id}`, created);
        }
        db.prepare(
          "INSERT INTO order_events(order_id,status,created) VALUES(?,?,?)",
        ).run(id, "Pending", created);
        db.prepare("UPDATE users SET phone=?,address=? WHERE id=?").run(
          phone,
          address,
          s.user_id,
        );
        return orderDTO(db.prepare("SELECT * FROM orders WHERE id=?").get(id));
      });
      return send(res, 201, result);
    }
    if (p.startsWith("/api/orders/") && method === "GET") {
      const id = p.split("/")[3],
        s = session(req);
      const o = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
      if (!s || !o || (s.role !== "admin" && o.user_id !== s.user_id))
        throw fail(404, "Order not found.");
      if (p.endsWith("/tracking")) {
        const points = [
          [6.5004, 124.8451],
          [6.5012, 124.8456],
          [6.5024, 124.8464],
          [6.5035, 124.8476],
          [6.5047, 124.8485],
          [6.506, 124.8502],
          [6.5075, 124.8521],
        ];
        const seconds = o.dispatch_at
          ? Math.max(0, (Date.now() - Date.parse(o.dispatch_at)) / 1000)
          : 0;
        const progress =
          o.status === "Completed"
            ? 1
            : o.status === "Out for delivery"
              ? Math.min(seconds / 180, 0.95)
              : 0;
        const pos = progress * (points.length - 1),
          i = Math.min(Math.floor(pos), points.length - 2),
          t = pos - i;
        return send(res, 200, {
          demo: true,
          available: o.method === "delivery",
          status: o.status,
          progress,
          route: points,
          position: [
            points[i][0] + (points[i + 1][0] - points[i][0]) * t,
            points[i][1] + (points[i + 1][1] - points[i][1]) * t,
          ],
          updated: now(),
          note: "Simulated route in Koronadal for demonstration. Not driver GPS or your entered address.",
        });
      }
      return send(res, 200, orderDTO(o));
    }
    if (p.startsWith("/api/admin/")) {
      requireAdmin(req);
      if (p === "/api/admin/orders" && method === "GET")
        return send(
          res,
          200,
          db
            .prepare("SELECT * FROM orders ORDER BY created DESC")
            .all()
            .map((o) => ({ ...orderDTO(o), nextStatuses: nextStatuses(o) })),
        );
      if (p === "/api/admin/customers" && method === "GET")
        return send(
          res,
          200,
          db
            .prepare(
              "SELECT u.id,u.name,u.email,u.phone,u.address,u.created,count(o.id) order_count,coalesce(sum(CASE WHEN o.status='Completed' THEN o.total ELSE 0 END),0) total_spent FROM users u LEFT JOIN orders o ON o.user_id=u.id GROUP BY u.id ORDER BY u.created DESC",
            )
            .all(),
        );
      if (p === "/api/admin/products" && method === "GET")
        return send(res, 200, {
          products: allProducts(true),
          movements: db
            .prepare(
              "SELECT m.*,p.name FROM stock_movements m JOIN products p ON p.id=m.product_id ORDER BY m.id DESC LIMIT 100",
            )
            .all(),
        });
      if (p === "/api/admin/products" && ["POST", "PATCH"].includes(method)) {
        const b = await body(req),
          name = str(b.name, 80),
          variety = str(b.variety),
          description = str(b.description, 2000),
          texture = str(b.texture, 500),
          cooking = str(b.cooking, 500),
          tag = str(b.tag, 40);
        if (
          !name ||
          !description ||
          !Number.isInteger(b.price) ||
          b.price < 1 ||
          b.price > 100000 ||
          !["Premium", "Everyday", "Value", "Whole grain"].includes(tag)
        )
          throw fail(
            400,
            "Enter a name, description, category, and a valid whole-peso price.",
          );
        if (method === "POST") {
          const r = db
            .prepare(
              "INSERT INTO products(name,variety,weight,price,stock,tag,description,texture,cooking) VALUES(?,?,25,?,0,?,?,?,?)",
            )
            .run(name, variety, b.price, tag, description, texture, cooking);
          return send(res, 201, { id: r.lastInsertRowid });
        }
        const product = db
          .prepare("SELECT * FROM products WHERE id=?")
          .get(Number(b.id));
        if (!product) throw fail(404, "Product not found.");
        if (b.active && product.weight !== 25)
          throw fail(
            400,
            "Only 25 kg products can be active in this wholesale catalog.",
          );
        db.prepare(
          "UPDATE products SET name=?,variety=?,price=?,tag=?,description=?,texture=?,cooking=?,active=? WHERE id=?",
        ).run(
          name,
          variety,
          b.price,
          tag,
          description,
          texture,
          cooking,
          b.active === false ? 0 : 1,
          product.id,
        );
        return send(res, 200, { ok: true });
      }
      if (p === "/api/admin/image" && method === "POST") {
        const b = await body(req, 3000000);
        const product = db
          .prepare("SELECT id FROM products WHERE id=?")
          .get(Number(b.id));
        if (!product) throw fail(404, "Product not found.");
        if (b.remove === true) {
          db.prepare("UPDATE products SET image='' WHERE id=?").run(product.id);
          return send(res, 200, { ok: true });
        }
        if (
          typeof b.data !== "string" ||
          !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.data)
        )
          throw fail(400, "Choose a PNG, JPEG, or WebP image.");
        const encoded = b.data.split(",")[1],
          buffer = Buffer.from(encoded, "base64");
        if (buffer.length > 2000000)
          throw fail(400, "Image must be under 2 MB.");
        const isPng = buffer
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const isJpg =
          buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
        const isWebp =
          buffer.subarray(0, 4).toString() === "RIFF" &&
          buffer.subarray(8, 12).toString() === "WEBP";
        const ext = isPng ? "png" : isJpg ? "jpg" : isWebp ? "webp" : null;
        if (!ext) throw fail(400, "Invalid image file.");
        const filename = randomBytes(16).toString("hex") + "." + ext;
        mkdirSync(path.join(dataDir, "uploads"), { recursive: true });
        writeFileSync(path.join(dataDir, "uploads", filename), buffer, {
          flag: "wx",
        });
        db.prepare("UPDATE products SET image=? WHERE id=?").run(
          "/media/" + filename,
          product.id,
        );
        return send(res, 200, { ok: true });
      }
      if (p === "/api/admin/stock" && method === "PATCH") {
        const b = await body(req),
          reason = str(b.reason, 300);
        if (
          !Number.isInteger(b.delta) ||
          b.delta === 0 ||
          Math.abs(b.delta) > 10000 ||
          !reason
        )
          throw fail(
            400,
            "Enter a nonzero whole-sack adjustment and a reason.",
          );
        transaction(() => {
          const product = db
            .prepare("SELECT * FROM products WHERE id=?")
            .get(Number(b.id));
          if (!product) throw fail(404, "Product not found.");
          if (product.stock + b.delta < 0 || product.stock + b.delta > 100000)
            throw fail(400, "Adjustment would produce invalid stock.");
          db.prepare("UPDATE products SET stock=stock+? WHERE id=?").run(
            b.delta,
            product.id,
          );
          db.prepare(
            "INSERT INTO stock_movements(product_id,delta,reason,created) VALUES(?,?,?,?)",
          ).run(product.id, b.delta, reason, now());
        });
        return send(res, 200, { ok: true });
      }
      if (p === "/api/admin/status" && method === "PATCH") {
        const b = await body(req);
        transaction(() => {
          const o = db
            .prepare("SELECT * FROM orders WHERE id=?")
            .get(str(b.id));
          if (!o) throw fail(404, "Order not found.");
          if (!nextStatuses(o).includes(b.status))
            throw fail(400, "Invalid order status transition.");
          if (b.status === "Cancelled")
            for (const i of db
              .prepare("SELECT * FROM order_items WHERE order_id=?")
              .all(o.id)) {
              db.prepare("UPDATE products SET stock=stock+? WHERE id=?").run(
                i.quantity,
                i.product_id,
              );
              db.prepare(
                "INSERT INTO stock_movements(product_id,delta,reason,created) VALUES(?,?,?,?)",
              ).run(i.product_id, i.quantity, `Cancelled ${o.id}`, now());
            }
          const payment =
            b.status === "Cancelled" && o.payment_status === "Demo paid"
              ? "Demo refunded"
              : o.payment_status;
          db.prepare(
            "UPDATE orders SET status=?,payment_status=?,dispatch_at=CASE WHEN ?='Out for delivery' THEN ? ELSE dispatch_at END WHERE id=?",
          ).run(b.status, payment, b.status, now(), o.id);
          db.prepare(
            "INSERT INTO order_events(order_id,status,created) VALUES(?,?,?)",
          ).run(o.id, b.status, now());
        });
        return send(res, 200, { ok: true });
      }
      if (p === "/api/admin/payment" && method === "PATCH") {
        const b = await body(req),
          o = db.prepare("SELECT * FROM orders WHERE id=?").get(str(b.id));
        if (
          !o ||
          o.status === "Cancelled" ||
          o.payment_method !== "cash" ||
          o.payment_status !== "Unpaid"
        )
          throw fail(
            400,
            "Only unpaid, active cash orders can be marked paid.",
          );
        db.prepare("UPDATE orders SET payment_status='Paid' WHERE id=?").run(
          o.id,
        );
        return send(res, 200, { ok: true });
      }
      if (p === "/api/admin/reports" && method === "GET") {
        const from = url.searchParams.get("from") || "2000-01-01",
          to = url.searchParams.get("to") || "2100-01-01";
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
          from > to
        )
          throw fail(400, "Select a valid date range.");
        const list = db
          .prepare(
            "SELECT * FROM orders WHERE status='Completed' AND date(created,'+8 hours') BETWEEN ? AND ? ORDER BY created DESC",
          )
          .all(from, to)
          .map(orderDTO);
        const byProduct = new Map();
        for (const o of list)
          for (const i of o.items) {
            const key = i.id;
            const v = byProduct.get(key) || {
              name: i.name,
              sacks: 0,
              sales: 0,
            };
            v.sacks += i.quantity;
            v.sales += i.quantity * i.price;
            byProduct.set(key, v);
          }
        const summary = {
          orders: list,
          total: list.reduce((s, o) => s + o.total, 0),
          deliveryFees: list.reduce((s, o) => s + o.delivery_fee, 0),
          bestSellers: [...byProduct.values()].sort(
            (a, b) => b.sacks - a.sacks,
          ),
        };
        if (url.searchParams.get("format") === "csv") {
          res.writeHead(200, {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="sako-sales.csv"',
            "Cache-Control": "no-store",
          });
          return res.end(
            "\uFEFF" +
              [
                [
                  "Order",
                  "Date (UTC)",
                  "Customer",
                  "Payment status",
                  "Total PHP",
                  "Delivery PHP",
                ],
                ...list.map((o) => [
                  o.id,
                  o.created,
                  o.customer,
                  o.payment_status,
                  o.total,
                  o.delivery_fee,
                ]),
              ]
                .map((row) => row.map(csvCell).join(","))
                .join("\r\n"),
          );
        }
        return send(res, 200, summary);
      }
    }
    if (p.startsWith("/api/")) throw fail(404, "Not found.");
    if (!["GET", "HEAD"].includes(method))
      throw fail(405, "Method not allowed.");
    if (/^\/media\/[a-f0-9]{32}\.(png|jpg|webp)$/.test(p)) {
      let image;
      try {
        image = readFileSync(path.join(dataDir, "uploads", path.basename(p)));
      } catch {
        throw fail(404, "Image not found.");
      }
      res.writeHead(200, {
        "Content-Type": p.endsWith(".png")
          ? "image/png"
          : p.endsWith(".jpg")
            ? "image/jpeg"
            : "image/webp",
        "Cache-Control": "public, max-age=86400",
      });
      return res.end(method === "HEAD" ? undefined : image);
    }
    const files = {
      "/": "public/index.html",
      "/admin": "public/index.html",
      "/assets/rice-fields.svg": "public/assets/rice-fields.svg",
      "/assets/demo-map.svg": "public/assets/demo-map.svg",
      "/assets/products/brown-rice.png":
        "public/assets/products/brown-rice.png",
      "/assets/products/well-milled.png":
        "public/assets/products/well-milled.png",
      "/assets/products/sinandomeng.png":
        "public/assets/products/sinandomeng.png",
      "/assets/products/jasmine.png": "public/assets/products/jasmine.png",
      "/assets/products/dinorado.png": "public/assets/products/dinorado.png",
      "/app.js": "public/app.js",
      "/style.css": "public/style.css",
      "/leaflet.js": "node_modules/leaflet/dist/leaflet.js",
      "/leaflet.css": "node_modules/leaflet/dist/leaflet.css",
    };
    if (!files[p]) throw fail(404, "Not found.");
    const content = readFileSync(path.join(root, files[p]));
    res.writeHead(200, {
      "Content-Type": p.endsWith(".png")
        ? "image/png"
        : p.endsWith(".svg")
          ? "image/svg+xml"
          : p.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : p.endsWith(".css")
              ? "text/css; charset=utf-8"
              : "text/html; charset=utf-8",
    });
    res.end(method === "HEAD" ? undefined : content);
  } catch (e) {
    if (!e.status) console.error("Request error:", e.message);
    send(res, e.status || 500, {
      error: e.status
        ? e.message
        : "Unable to process request. Please try again.",
    });
  }
});
server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log(`Sako Supply listening on port ${process.env.PORT || 3000}`),
);
