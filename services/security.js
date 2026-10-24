export class WindowLimiter {
  constructor(limit, windowMs, clock = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.clock = clock;
    this.entries = new Map();
  }
  prune() {
    const time = this.clock();
    for (const [key, v] of this.entries)
      if (v.until <= time) this.entries.delete(key);
  }
  check(key) {
    const v = this.entries.get(key);
    if (v && v.until > this.clock() && v.count >= this.limit)
      throw Object.assign(
        Error("Too many attempts. Please wait before trying again."),
        { status: 429, retryAfter: Math.ceil((v.until - this.clock()) / 1000) },
      );
  }
  hit(key) {
    this.prune();
    if (this.entries.size >= 10000 && !this.entries.has(key))
      throw Object.assign(Error("Service busy. Please try again shortly."), {
        status: 429,
        retryAfter: 60,
      });
    const v = this.entries.get(key) || {
      count: 0,
      until: this.clock() + this.windowMs,
    };
    v.count++;
    this.entries.set(key, v);
  }
  clear(key) {
    this.entries.delete(key);
  }
}
export const loginFailures = new WindowLimiter(8, 600000);
export const ipFailures = new WindowLimiter(80, 600000);
export const registrations = new WindowLimiter(20, 600000);
export const orderRequests = new WindowLimiter(20, 60000);
export function authKey(req, email) {
  return `${req.socket.remoteAddress}|${email}`;
}
export const contentSecurityPolicy =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
