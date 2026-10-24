import { db } from "../db.js";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import {
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
  registrations,
  authKey,
} from "../services/security.js";
const scrypt = promisify(scryptCallback);
export async function accountsRoute({ p, method, req, res, send }) {
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
