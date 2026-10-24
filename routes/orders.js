import { trackingDTO } from "../services/tracking.js";
import { db, transaction } from "../db.js";
import { randomBytes } from "node:crypto";
import { session, requireCustomer } from "../auth.js";
import { body } from "../services/http.js";
import { now, str, fail } from "../services/common.js";
import { priceOrder } from "../services/pricing.js";
import { orderRequests } from "../services/security.js";
export async function ordersRoute({ p, method, req, res, send, orderDTO }) {
  if (p === "/api/notifications" && method === "GET") {
    const s = requireCustomer(req);
    return send(
      res,
      200,
      db
        .prepare(
          "SELECT id,order_id,message,created,read FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50",
        )
        .all(s.user_id),
    );
  }
  if (p === "/api/notifications/read" && method === "POST") {
    const s = requireCustomer(req);
    db.prepare("UPDATE notifications SET read=1 WHERE user_id=?").run(
      s.user_id,
    );
    return send(res, 200, { ok: true });
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
    orderRequests.check(s.user_id);
    orderRequests.hit(s.user_id);
    if (
      ["cardNumber", "card_number", "cvc", "cvv", "expiry"].some((k) => k in b)
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
      const quote = priceOrder(items, b.method, b.delivery_zone || "koronadal");
      for (let index = 0; index < items.length; index++)
        Object.assign(items[index], quote.lines[index]);
      const fee = quote.delivery_fee_centavos / 100,
        total = quote.total_centavos / 100;
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
      db.prepare(
        "UPDATE orders SET subtotal_centavos=?,discount_centavos=?,total_centavos=?,delivery_zone=? WHERE id=?",
      ).run(
        quote.subtotal_centavos,
        quote.discount_centavos,
        quote.total_centavos,
        quote.delivery_zone,
        id,
      );
      for (const i of items) {
        db.prepare("UPDATE products SET stock=stock-? WHERE id=?").run(
          i.quantity,
          i.id,
        );
        db.prepare(
          "INSERT INTO order_items(order_id,product_id,name,weight,price,quantity,original_price_centavos) VALUES(?,?,?,?,?,?,?)",
        ).run(
          id,
          i.id,
          i.name,
          i.weight,
          i.price,
          i.quantity,
          i.original_price_centavos,
        );
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
      db.prepare(
        "INSERT INTO notifications(user_id,order_id,message,created) VALUES(?,?,?,?)",
      ).run(
        s.user_id,
        id,
        "Order placed. This is an in-app demo notification, not an SMS/email.",
        created,
      );
      return orderDTO(db.prepare("SELECT * FROM orders WHERE id=?").get(id));
    });
    return send(res, 201, result);
  }
  if (/^\/api\/orders\/[^/]+\/cancel$/.test(p) && method === "POST") {
    const customer = requireCustomer(req),
      id = p.split("/")[3];
    transaction(() => {
      const o = db
        .prepare("SELECT * FROM orders WHERE id=? AND user_id=?")
        .get(id, customer.user_id);
      if (!o) throw fail(404, "Order not found.");
      if (o.status !== "Pending")
        throw fail(400, "Only Pending orders can be cancelled by a customer.");
      for (const i of db
        .prepare("SELECT * FROM order_items WHERE order_id=?")
        .all(id)) {
        db.prepare("UPDATE products SET stock=stock+? WHERE id=?").run(
          i.quantity,
          i.product_id,
        );
        db.prepare(
          "INSERT INTO stock_movements(product_id,delta,reason,created) VALUES(?,?,?,?)",
        ).run(i.product_id, i.quantity, "Customer cancelled " + id, now());
      }
      db.prepare(
        "UPDATE orders SET status='Cancelled',payment_status=CASE WHEN payment_status='Demo paid' THEN 'Demo refunded' WHEN payment_status='Paid' THEN 'Refund due' ELSE payment_status END WHERE id=?",
      ).run(id);
      db.prepare(
        "INSERT INTO order_events(order_id,status,created) VALUES(?,?,?)",
      ).run(id, "Cancelled", now());
      db.prepare(
        "INSERT INTO notifications(user_id,order_id,message,created) VALUES(?,?,?,?)",
      ).run(
        customer.user_id,
        id,
        "You cancelled this order. Reserved stock has been restored.",
        now(),
      );
    });
    return send(res, 200, { ok: true });
  }
  if (p.startsWith("/api/orders/") && method === "GET") {
    const id = p.split("/")[3],
      s = session(req);
    const o = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
    if (!s || !o || (s.role !== "admin" && o.user_id !== s.user_id))
      throw fail(404, "Order not found.");
    if (p.endsWith("/tracking")) {
      return send(res, 200, trackingDTO(o));
    }
    return send(res, 200, orderDTO(o));
  }

  throw fail(405, "Method not allowed.");
}
