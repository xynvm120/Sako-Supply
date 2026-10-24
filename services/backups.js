import { makeBackup } from "../scripts/backup.js";
export function scheduleBackups() {
  // 02:00 Philippine time = 18:00 UTC on the preceding date. Timers survive only while the server runs.
  const next = new Date();
  next.setUTCHours(18, 0, 0, 0);
  if (+next <= Date.now()) next.setUTCDate(next.getUTCDate() + 1);
  const timer = setTimeout(async () => {
    try {
      await makeBackup();
      console.log("Nightly backup completed.");
    } catch (e) {
      console.error("Backup failed:", e.message);
    }
    scheduleBackups();
  }, +next - Date.now());
  timer.unref();
}
