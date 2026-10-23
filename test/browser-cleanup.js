import { rmSync } from "node:fs";
export default function () {
  if (process.env.SAKO_E2E_DATA)
    rmSync(process.env.SAKO_E2E_DATA, { recursive: true, force: true });
}
