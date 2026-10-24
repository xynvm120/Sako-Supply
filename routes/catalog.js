import { db, dataDir, transaction } from "../db.js";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { body } from "../services/http.js";
import { now, str, fail } from "../services/common.js";
export async function catalogRoute({ p, method, req, res, send, allProducts }) {
  if (p === "/api/admin/reorder-point" && method === "PATCH") {
    const b = await body(req);
    if (
      !Number.isInteger(b.reorder_point) ||
      b.reorder_point < 0 ||
      b.reorder_point > 100000
    )
      throw fail(400, "Enter a valid reorder point.");
    const r = db
      .prepare("UPDATE products SET reorder_point=? WHERE id=?")
      .run(b.reorder_point, Number(b.id));
    if (!r.changes) throw fail(404, "Product not found.");
    return send(res, 200, { ok: true });
  }
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
    if (buffer.length > 2000000) throw fail(400, "Image must be under 2 MB.");
    const isPng = buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
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
      throw fail(400, "Enter a nonzero whole-sack adjustment and a reason.");
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

  throw fail(405, "Method not allowed.");
}
