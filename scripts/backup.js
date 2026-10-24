import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync, cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export async function makeBackup() {
  const data = process.env.DATA_DIR || path.join(root, "data");
  if (!existsSync(path.join(data, "sako.sqlite")))
    throw Error("No database exists yet. Start the application first.");
  const directory = path.join(
    process.env.BACKUP_DIR || path.join(root, "backups"),
    new Date().toISOString().replaceAll(":", "-") + "-" + process.pid,
  );
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(data, "sako.sqlite"), {
    readOnly: true,
  });
  try {
    await backup(db, path.join(directory, "sako.sqlite"));
  } finally {
    db.close();
  }
  if (existsSync(path.join(data, "uploads")))
    cpSync(path.join(data, "uploads"), path.join(directory, "uploads"), {
      recursive: true,
      errorOnExist: true,
    });
  return directory;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  makeBackup()
    .then((directory) => console.log("Backup saved:", directory))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
