// Mail credentials remain server-side. No delivery is claimed without provider acceptance.
export function mailReady() {
  try {
    const url = new URL(process.env.PUBLIC_URL || "");
    return Boolean(process.env.EMAIL_API_KEY && process.env.EMAIL_FROM &&
      (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) &&
      !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash);
  } catch { return false; }
}
export async function sendAccountMail(email, code, purpose) {
  if (!mailReady()) throw Error("Mail not configured");
  const verification = purpose === "verify";
  const fragment = new URLSearchParams({flow: verification ? "verify" : "recover", email, code});
  const link = new URL(process.env.PUBLIC_URL).origin + "/#" + fragment;
  const response = await fetch(process.env.EMAIL_API_URL || "https://api.resend.com/emails", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: {"Authorization": `Bearer ${process.env.EMAIL_API_KEY}`, "Content-Type": "application/json"},
    body: JSON.stringify({from:process.env.EMAIL_FROM, to:[email],
      subject: verification ? "Verify your Sako Supply email" : "Reset your Sako Supply password",
      text: `${verification ? "Verify your email address" : "Reset your password"}:\n${link}\n\nOr enter this single-use code: ${code}\nExpires in 15 minutes. If you did not request this, ignore this message. Never share this code. Sako Supply research prototype.`})
  });
  if (!response.ok) throw Error("Mail provider rejected message");
}
