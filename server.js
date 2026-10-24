import { wholesaleRoute } from "./routes/wholesale.js";
import { storeSettings,expireReservations } from "./services/wholesale.js";
import { trackingRoute } from "./routes/tracking.js";
import { mapConfig, cleanupTracking } from "./services/tracking.js";
import { mailReady } from "./services/mail.js";
import http from "node:http";
import { scheduleBackups } from "./services/backups.js";
import { accountsRoute } from "./routes/accounts.js";
import { ordersRoute } from "./routes/orders.js";
import { catalogRoute } from "./routes/catalog.js";
import { reportsRoute } from "./routes/reports.js";
import { adminEmail, adminPassword, requireAdmin } from "./auth.js";
import { db, dataDir, transaction } from "./db.js";
import { now, str, fail } from "./services/common.js";
import { bulkTiers, deliveryZones } from "./services/pricing.js";
import { contentSecurityPolicy } from "./services/security.js";
import { body } from "./services/http.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(fileURLToPath(import.meta.url));
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
function orderDTO(o) {
  return {
    ...o,
    items: db
      .prepare(
        "SELECT product_id AS id,name,weight,price,quantity,unit_price_centavos,original_price_centavos FROM order_items WHERE order_id=?",
      )
      .all(o.id),
    events: db
      .prepare(
        "SELECT status,created FROM order_events WHERE order_id=? ORDER BY id",
      )
      .all(o.id),
    proof: db.prepare("SELECT * FROM delivery_proofs WHERE order_id=?").get(o.id) || null,
    feedback: db.prepare("SELECT rating,comment,updated FROM order_feedback WHERE order_id=?").get(o.id) || null,
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
  res.setHeader("Content-Security-Policy", contentSecurityPolicy);
  const requestStart = Date.now();
  res.on("finish", () => {
    if (process.env.REQUEST_LOG !== "off")
      console.log(
        JSON.stringify({
          method: req.method,
          path: req.url.split("?")[0].slice(0, 180),
          status: res.statusCode,
          ms: Date.now() - requestStart,
        }),
      );
  });
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(self)");
  res.setHeader("X-Frame-Options", "DENY");
  try {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    const method = req.method;
    if(p.startsWith("/api/")) expireReservations();
    if (
      ["POST", "PATCH", "DELETE", "PUT"].includes(method) &&
      req.headers.origin &&
      req.headers.origin !== `http://${req.headers.host}` &&
      req.headers.origin !== `https://${req.headers.host}`
    )
      throw fail(403, "Cross-site request rejected.");
    if (p === "/health" && method === "GET") {
      db.prepare("SELECT 1").get();
      return send(res, 200, { status: "ok", database: "sqlite", demo: true });
    }
    if (p === "/api/config" && method === "GET")
      return send(res, 200, {
        demo: true,
        emailRecovery: mailReady(),
        map: mapConfig(),
        supportEmail: /^\S+@\S+\.\S+$/.test(process.env.SUPPORT_EMAIL || "") ? process.env.SUPPORT_EMAIL : null,
        weight: 25,
        minSacks: storeSettings().min_sacks,
        reservationMinutes: storeSettings().reservation_minutes,
        deliveryFee,
        deliveryZones,
        bulkTiers,
        paymentMethods: ["cash", "card", "gcash", "maya"],
      });
    if(p==='/api/delivery-slots' || ['/api/admin/store-settings','/api/admin/feedback'].includes(p) || /^\/api\/orders\/[^/]+\/(feedback|confirm-delivery)$/.test(p)) return await wholesaleRoute({p,method,req,res,send});
    if (p === "/api/products" && method === "GET")
      return send(res, 200, allProducts());
    if (
      [
        "/api/session",
        "/api/auth/register",
        "/api/auth/recovery-code",
        "/api/auth/request-verification",
        "/api/auth/verify-email",
        "/api/auth/forgot-password",
        "/api/auth/reset-password",
        "/api/auth/login",
        "/api/login",
        "/api/logout",
        "/api/profile",
      ].includes(p)
    )
      return await accountsRoute({ p, method, req, res, send });
    if (
      p === "/api/orders" ||
      p.startsWith("/api/orders/") ||
      p.startsWith("/api/notifications")
    )
      return await ordersRoute({ p, method, req, res, send, orderDTO });
    if (p.startsWith("/api/driver/") || p === "/api/admin/driver-access")
      return await trackingRoute({p,method,req,res,send});
    if (p.startsWith("/api/admin/")) {
      const administrator = requireAdmin(req);
      if (["POST", "PATCH", "DELETE"].includes(method))
        res.once("finish", () => {
          if (res.statusCode < 400)
            db.prepare(
              "INSERT INTO admin_log(actor,action,created) VALUES(?,?,?)",
            ).run(
              administrator.actor || adminEmail,
              method +
                " " +
                p +
                (req.auditTarget ? " [" + req.auditTarget + "]" : ""),
              now(),
            );
        });
      if (p === "/api/admin/metrics" && method === "GET") {
        const rows = db
          .prepare(
            "SELECT date(created,'+8 hours') day,sum(total_centavos) cents FROM orders WHERE status='Completed' GROUP BY day ORDER BY day DESC LIMIT 90",
          )
          .all();
        return send(res, 200, {
          daily: rows,
          caption:
            "Completed-order totals by placement date; includes demo payments and delivery.",
        });
      }
      if (p === "/api/admin/audit" && method === "GET")
        return send(
          res,
          200,
          db
            .prepare("SELECT * FROM admin_log ORDER BY id DESC LIMIT 100")
            .all(),
        );
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
      if (
        [
          "/api/admin/products",
          "/api/admin/reorder-point",
          "/api/admin/image",
          "/api/admin/stock",
        ].includes(p)
      )
        return await catalogRoute({ p, method, req, res, send, allProducts });
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
          if (["Completed","Cancelled"].includes(b.status)) {
            db.prepare("DELETE FROM driver_locations WHERE order_id=?").run(o.id);
            db.prepare("DELETE FROM driver_access WHERE order_id=?").run(o.id);
          }
          db.prepare(
            "INSERT INTO order_events(order_id,status,created) VALUES(?,?,?)",
          ).run(o.id, b.status, now());
          if (o.user_id)
            db.prepare(
              "INSERT INTO notifications(user_id,order_id,message,created) VALUES(?,?,?,?)",
            ).run(o.user_id, o.id, "Order status: " + b.status, now());
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
        transaction(() => {
          db.prepare("UPDATE orders SET payment_status='Paid' WHERE id=?").run(
            o.id,
          );
          db.prepare(
            "INSERT INTO collections(order_id,amount_centavos,actor,created) VALUES(?,?,?,?)",
          ).run(
            o.id,
            o.total_centavos || Math.round(o.total * 100),
            administrator.actor || adminEmail,
            now(),
          );
        });
        return send(res, 200, { ok: true });
      }
      if (p === "/api/admin/reports" && method === "GET")
        return reportsRoute({ db, url, res, send, orderDTO, fail, csvCell });
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
        "Content-Type": p.endsWith(".webmanifest")
          ? "application/manifest+json"
          : p.endsWith(".webm")
            ? "video/webm"
            : p.endsWith(".vtt")
              ? "text/vtt"
              : p.endsWith(".png")
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
      "/driver": "public/driver.html",
      "/driver.js": "public/driver.js",
      "/scroll-top.js": "public/scroll-top.js",
      "/help.html": "public/help.html",
      "/returns.html": "public/returns.html",
      "/support.js": "public/support.js",
      "/privacy.html": "public/privacy.html",
      "/agreement.html": "public/agreement.html",
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
      "/theme-init.js": "public/theme-init.js",
      "/sw.js": "public/sw.js",
      "/manifest.webmanifest": "public/manifest.webmanifest",
      "/assets/app-icon.svg": "public/assets/app-icon.svg",
      "/assets/app-icon-192.png": "public/assets/app-icon-192.png",
      "/assets/app-icon-512.png": "public/assets/app-icon-512.png",
      "/assets/ordering-guide.webm": "public/assets/ordering-guide.webm",
      "/assets/ordering-guide.vtt": "public/assets/ordering-guide.vtt",
      "/style.css": "public/style.css",
      "/css/base.css": "public/css/base.css",
      "/css/components.css": "public/css/components.css",
      "/css/storefront.css": "public/css/storefront.css",
      "/css/themes.css": "public/css/themes.css",
      "/css/features.css": "public/css/features.css",
      "/leaflet.js": "node_modules/leaflet/dist/leaflet.js",
      "/leaflet.css": "node_modules/leaflet/dist/leaflet.css",
    };
    if (!files[p]) throw fail(404, "Not found.");
    const content = readFileSync(path.join(root, files[p]));
    res.setHeader("Cache-Control", "no-cache");
    res.writeHead(200, {
      "Content-Type": p.endsWith(".webmanifest")
        ? "application/manifest+json"
        : p.endsWith(".webm")
          ? "video/webm"
          : p.endsWith(".vtt")
            ? "text/vtt"
            : p.endsWith(".png")
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
    if (e.retryAfter) res.setHeader("Retry-After", String(e.retryAfter));
    send(res, e.status || 500, {
      error: e.status
        ? e.message
        : "Unable to process request. Please try again.",
    });
  }
});
expireReservations();
setInterval(()=>{try {expireReservations();}catch(e){console.error("Reservation cleanup failed:",e.message);}},30000).unref();
cleanupTracking();
setInterval(cleanupTracking, 60000).unref();
if (process.env.AUTO_BACKUP !== "off") scheduleBackups();
if (adminPassword === "admin123")
  console.warn(
    "WARNING: demo admin password is active. Set ADMIN_PASSWORD before exposing this server.",
  );
server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log(`Sako Supply listening on port ${process.env.PORT || 3000}`),
);
