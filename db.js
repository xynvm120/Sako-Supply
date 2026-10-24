import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
export const root = path.dirname(fileURLToPath(import.meta.url));
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

export { db, dataDir, column };
// Additive migrations retain historical receipts and legacy JSON snapshots.
column("products", "price_centavos", "INTEGER");
column(
  "products",
  "reorder_point",
  "INTEGER NOT NULL DEFAULT 10 CHECK(reorder_point >= 0)",
);
column("orders", "total_centavos", "INTEGER");
column("orders", "subtotal_centavos", "INTEGER");
column("orders", "discount_centavos", "INTEGER NOT NULL DEFAULT 0");
column("orders", "delivery_zone", "TEXT NOT NULL DEFAULT ''");
column("order_items", "unit_price_centavos", "INTEGER");
column("order_items", "original_price_centavos", "INTEGER");
column("sessions", "actor", "TEXT NOT NULL DEFAULT ''");
db.exec(`
 UPDATE products SET price_centavos=round(price*100) WHERE price_centavos IS NULL;
 UPDATE orders SET total_centavos=round(total*100) WHERE total_centavos IS NULL;
 UPDATE orders SET subtotal_centavos=round((total-delivery_fee)*100) WHERE subtotal_centavos IS NULL;
 UPDATE order_items SET unit_price_centavos=round(price*100) WHERE unit_price_centavos IS NULL;
 UPDATE order_items SET original_price_centavos=unit_price_centavos WHERE original_price_centavos IS NULL;
 CREATE INDEX IF NOT EXISTS orders_created ON orders(created);
 CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
 CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
 CREATE TABLE IF NOT EXISTS admin_log(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),order_id TEXT REFERENCES orders(id),message TEXT NOT NULL,created TEXT NOT NULL,read INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS collections(id INTEGER PRIMARY KEY,order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),amount_centavos INTEGER NOT NULL CHECK(amount_centavos>0),actor TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS products_validate_insert BEFORE INSERT ON products
 WHEN NEW.name IS NULL OR trim(NEW.name)='' OR NEW.stock IS NULL OR typeof(NEW.stock)<>'integer' OR NEW.stock<0 OR NEW.price IS NULL OR NEW.price<=0 OR NEW.weight IS NULL OR NEW.weight<=0
 BEGIN SELECT RAISE(ABORT,'Invalid product or negative stock'); END;
 CREATE TRIGGER IF NOT EXISTS products_validate_update BEFORE UPDATE ON products
 WHEN NEW.name IS NULL OR trim(NEW.name)='' OR NEW.stock IS NULL OR typeof(NEW.stock)<>'integer' OR NEW.stock<0 OR NEW.price IS NULL OR NEW.price<=0 OR NEW.weight IS NULL OR NEW.weight<=0
 BEGIN SELECT RAISE(ABORT,'Invalid product or negative stock'); END;
 CREATE TRIGGER IF NOT EXISTS products_price_insert AFTER INSERT ON products BEGIN UPDATE products SET price_centavos=round(NEW.price*100) WHERE id=NEW.id; END;
 CREATE TRIGGER IF NOT EXISTS products_price_update AFTER UPDATE OF price ON products BEGIN UPDATE products SET price_centavos=round(NEW.price*100) WHERE id=NEW.id; END;
 CREATE TRIGGER IF NOT EXISTS order_items_money AFTER INSERT ON order_items BEGIN UPDATE order_items SET unit_price_centavos=round(NEW.price*100) WHERE id=NEW.id; END;
`);
export function cleanupSessions() {
  db.prepare("DELETE FROM password_resets WHERE expires<=?").run(Date.now());
  return db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now())
    .changes;
}
cleanupSessions();
const cleanupTimer = setInterval(cleanupSessions, 15 * 60 * 1000);
cleanupTimer.unref();

export const transaction = (f) => {
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
