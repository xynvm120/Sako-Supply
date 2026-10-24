export const now = () => new Date().toISOString();
export const str = (value, max = 150) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
export const fail = (status, message) =>
  Object.assign(Error(message), { status });
