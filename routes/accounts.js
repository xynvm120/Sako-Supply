import { mailReady, sendAccountMail } from "../services/mail.js";
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
const mailIpLimit = new WindowLimiter(15, 900000);
const mailAccountLimit = new WindowLimiter(3, 900000);
const recoveryLimit = new WindowLimiter(8, 600000);
const tokenHash = value => createHash("sha256").update(value).digest("hex");
const scrypt = promisify(scryptCallback);
export async function accountsRoute({ p, method, req, res, send }) {
  if (p === "/api/auth/verify-email" && method === "POST") {
    recoveryLimit.check(req.socket.remoteAddress); recoveryLimit.hit(req.socket.remoteAddress);
    const b = await body(req);
    const digest = tokenHash(str(b.code,128));
    const entry = db.prepare("SELECT v.user_id FROM email_verifications v JOIN users u ON u.id=v.user_id WHERE v.token_hash=? AND v.expires>? AND u.email=?").get(digest,Date.now(),str(b.email,254).toLowerCase());
    if (!entry) throw fail(400,"Invalid or expired verification code.");
    db.exec("BEGIN IMMEDIATE");
    try {
      const used = db.prepare("DELETE FROM email_verifications WHERE user_id=? AND token_hash=? AND expires>?").run(entry.user_id,digest,Date.now());
      if (!used.changes) throw fail(400,"Invalid or expired verification code.");
      db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(now(),entry.user_id);
      db.exec("COMMIT");
    } catch(e) { db.exec("ROLLBACK"); throw e; }
    return send(res,200,{ok:true});
  }
  if (["/api/auth/request-verification","/api/auth/forgot-password"].includes(p) && method === "POST") {
    const verification = p.endsWith("request-verification");
    const identity = verification ? requireCustomer(req) : null;
    if (!mailReady()) throw fail(503,"Email delivery is not connected. Contact the administrator for assisted recovery.");
    const b = await body(req);
    const customer = verification
      ? db.prepare("SELECT * FROM users WHERE id=?").get(identity.user_id)
      : db.prepare("SELECT * FROM users WHERE email=?").get(str(b.email,254).toLowerCase());
    const email = verification ? customer.email : str(b.email,254).toLowerCase();
    mailIpLimit.check(req.socket.remoteAddress); mailAccountLimit.check(email);
    mailIpLimit.hit(req.socket.remoteAddress); mailAccountLimit.hit(email);
    if (customer && (verification ? !customer.email_verified_at : customer.email_verified_at)) {
      const code = randomBytes(24).toString("hex");
      const table = verification ? "email_verifications" : "password_resets";
      db.prepare(`INSERT OR REPLACE INTO ${table}(user_id,token_hash,expires) VALUES(?,?,?)`).run(customer.id,tokenHash(code),Date.now()+900000);
      try { await sendAccountMail(email,code,verification ? "verify" : "reset"); }
      catch {
        db.prepare(`DELETE FROM ${table} WHERE user_id=? AND token_hash=?`).run(customer.id,tokenHash(code));
        // Never log tokens, email addresses, credentials, or provider response bodies.
        console.warn("Account email delivery failed; check provider configuration.");
        if (verification) throw fail(503,"Email could not be sent. Try again later or contact the administrator.");
      }
    }
    return send(res,200,{message: verification ? "If your email needs verification, a message has been requested. Check your inbox and spam folder." : "If this address belongs to an account with a verified email, recovery instructions have been requested. Otherwise contact the administrator."});
  }
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
    const phone=str(b.phone,30),address=str(b.address,500);
    if(!/^\+?[\d\s-]+$/.test(phone) || !/^\d{10,15}$/.test(phone.replace(/\D/g,""))) throw fail(400,"Enter a valid mobile number for order contact.");
    if(b.address!==undefined && (typeof b.address!=="string" || b.address.length>500)) throw fail(400,"Use an address of up to 500 characters.");
    if(b.agreement!==true || b.privacy_ack!==true) throw fail(400,"Accept the User Agreement and acknowledge the Data Privacy Notice to register.");
    const salt = randomBytes(16).toString("hex"),
      derived = (await scrypt(password, salt, 64)).toString("hex");
    const id = randomBytes(12).toString("hex");
    try {
      db.prepare(
        "INSERT INTO users(id,name,email,password_hash,salt,created,phone,address,terms_version,privacy_version,policy_accepted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      ).run(id, name, email, derived, salt, now(),phone,address,"2026-10-26","2026-10-26",now());
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
