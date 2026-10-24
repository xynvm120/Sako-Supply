import { db } from "../db.js";
import { createHash, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import {
  requireAdmin,
  adminEmail,
  adminPassword,
  publicUser,
  session,
  requireCustomer,
  setSession,
  revoke,
  safe,
} from "../auth.js";
import { body } from "../services/http.js";
import { now, str, fail } from "../services/common.js";
import {
  loginFailures,
  ipFailures,
  WindowLimiter,
  registrations,
  authKey,
} from "../services/security.js";
const recoveryLimit = new WindowLimiter(8, 600000);
const tokenHash = value => createHash("sha256").update(value).digest("hex");
const scrypt = promisify(scryptCallback);
export async function accountsRoute({ p, method, req, res, send }) {
  if (p === "/api/auth/recovery-code" && method === "POST") {
    const admin = requireAdmin(req);
    const b = await body(req);
    if (b.identity_verified !== true) throw fail(400, "Verify the customer's identity before issuing a code.");
    const customer = db.prepare("SELECT id FROM users WHERE email=?").get(str(b.email,254).toLowerCase());
    if (!customer) throw fail(404, "Customer not found.");
    const code = randomBytes(24).toString("hex");
    db.prepare("DELETE FROM password_resets WHERE expires<=?").run(Date.now());
    db.prepare("INSERT OR REPLACE INTO password_resets(user_id,token_hash,expires) VALUES(?,?,?)").run(customer.id, tokenHash(code), Date.now()+900000);
    db.prepare("INSERT INTO admin_log(actor,action,created) VALUES(?,?,?)").run(admin.actor || adminEmail, "Issued password recovery code for " + customer.id, now());
    return send(res,200,{code, expires_minutes:15});
  }
  if (p === "/api/auth/reset-password" && method === "POST") {
    const key = req.socket.remoteAddress;
    recoveryLimit.check(key); recoveryLimit.hit(key);
    const b = await body(req);
    const password = b.password;
    if (typeof password !== "string" || password.length<8 || password.length>128) throw fail(400,"Use a password of 8–128 characters.");
    const digest = tokenHash(str(b.code,128));
    const reset = db.prepare("SELECT r.user_id FROM password_resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=? AND r.expires>? AND u.email=?").get(digest,Date.now(),str(b.email,254).toLowerCase());
    if (!reset) throw fail(400,"Invalid or expired recovery code.");
    const salt = randomBytes(16).toString("hex");
    const derived = (await scrypt(password,salt,64)).toString("hex");
    db.exec("BEGIN IMMEDIATE");
    try {
      const used = db.prepare("DELETE FROM password_resets WHERE user_id=? AND token_hash=? AND expires>?").run(reset.user_id,digest,Date.now());
      if (!used.changes) throw fail(400,"Invalid or expired recovery code.");
      db.prepare("UPDATE users SET password_hash=?,salt=? WHERE id=?").run(derived,salt,reset.user_id);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(reset.user_id);
      db.exec("COMMIT");
    } catch(e) { db.exec("ROLLBACK"); throw e; }
    return send(res,200,{ok:true});
  }
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
    registrations.check(req.socket.remoteAddress);
    registrations.hit(req.socket.remoteAddress);
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
    const b = await body(req),
      email = str(b.email, 254).toLowerCase();
    const key = authKey(req, email),
      ip = req.socket.remoteAddress;
    loginFailures.check(key);
    ipFailures.check(ip);
    const badLogin = () => {
      loginFailures.hit(key);
      ipFailures.hit(ip);
      return fail(401, "Incorrect email or password.");
    };
    if (typeof b.password !== "string" || b.password.length > 128)
      throw badLogin();
    if (email === adminEmail) {
      if (!safe(b.password, adminPassword)) throw badLogin();
      loginFailures.clear(key);
      revoke(req);
      setSession(res, null, "admin");
      return send(res, 200, { admin: true, user: null });
    }
    const u = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    const derived = (
      await scrypt(b.password, u?.salt || "missing-user-timing-salt", 64)
    ).toString("hex");
    if (!u || !safe(derived, u.password_hash)) throw badLogin();
    loginFailures.clear(key);
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

  throw fail(405, "Method not allowed.");
}
