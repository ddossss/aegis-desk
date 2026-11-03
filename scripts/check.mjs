import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { messages } from "../ui/i18n.js";
for (const folder of ["app", "core", "ui", "scripts", "tests"])
  for (const file of fs
    .readdirSync(folder)
    .filter((f) => /\.(m?js|cjs)$/.test(f))) {
    const r = spawnSync(process.execPath, ["--check", folder + "/" + file], {
      stdio: "inherit",
    });
    if (r.status) process.exit(r.status);
  }
for (const [key, value] of Object.entries(messages))
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((v) => typeof v !== "string" || !v)
  )
    throw new Error("Missing translation: " + key);
const source = fs.readFileSync("ui/renderer.js", "utf8");
for (const match of source.matchAll(
  /(?:t|text|title|button|field|check)\(\s*(['"])([^'"]+)\1/g,
))
  if (!messages[match[2]]) throw new Error("Missing UI key: " + match[2]);
console.log(
  `PASS: JavaScript syntax and ${Object.keys(messages).length} trilingual messages`,
);
