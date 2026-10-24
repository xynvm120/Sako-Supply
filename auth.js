import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { db } from "./db.js";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const fail = (status, message) => Object.assign(Error(message), { status });
const safe = (a, b) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
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
  db.prepare(
    "INSERT INTO sessions(token_hash,user_id,role,expires,actor) VALUES(?,?,?,?,?)",
  ).run(
    hash(token),
    userId,
    role,
    Date.now() + 86400000,
    role === "admin" ? adminEmail : userId,
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

export {
  adminEmail,
  adminPassword,
  publicUser,
  session,
  requireAdmin,
  requireCustomer,
  setSession,
  revoke,
  safe,
};
