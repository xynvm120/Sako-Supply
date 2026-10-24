export async function body(req, limit = 40000) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit)
      throw Object.assign(Error("Request too large."), { status: 413 });
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("Expected object");
    if (value.id !== undefined)
      req.auditTarget = String(value.id)
        .replace(/[^A-Za-z0-9-]/g, "")
        .slice(0, 80);
    return value;
  } catch {
    throw Object.assign(Error("Invalid JSON request."), { status: 400 });
  }
}
