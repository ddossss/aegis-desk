import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { noLinks, fail, providers } from "./guard.mjs";

export function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  noLinks(path.dirname(file));
  if (fs.existsSync(file)) noLinks(file);
  const temporary = file + "." + crypto.randomUUID() + ".tmp";
  try {
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(value, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
export function validateConfig(c) {
  if (
    c?.version !== 1 ||
    !["ko", "ja", "en"].includes(c.language) ||
    typeof c.paused !== "boolean" ||
    !Array.isArray(c.workspaces) ||
    c.workspaces.length > 50
  )
    fail("stateInvalid");
  const ids = new Set();
  for (const w of c.workspaces) {
    if (
      !/^[a-f0-9-]{36}$/.test(w.id) ||
      ids.has(w.id) ||
      typeof w.root !== "string" ||
      !path.isAbsolute(w.root) ||
      typeof w.name !== "string" ||
      w.name.length > 80 ||
      !["review", "auto"].includes(w.mode) ||
      !Array.isArray(w.providers) ||
      w.providers.some((p) => !providers.includes(p)) ||
      typeof w.dev !== "string" ||
      !/^\d+$/.test(w.dev) ||
      typeof w.ino !== "string" ||
      !/^\d+$/.test(w.ino) ||
      !Number.isInteger(w.revision)
    )
      fail("stateInvalid");
    ids.add(w.id);
  }
  for (const p of providers)
    if (typeof c.models?.[p] !== "string" || c.models[p].length > 150)
      fail("stateInvalid");
  return c;
}
export class Store {
  constructor(root, language = "en") {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    noLinks(this.root);
    this.file = path.join(this.root, "settings.json");
    if (fs.existsSync(this.file)) {
      noLinks(this.file);
      if (fs.statSync(this.file).size > 256 * 1024) fail("stateInvalid");
    }
    this.config = fs.existsSync(this.file)
      ? validateConfig(JSON.parse(fs.readFileSync(this.file, "utf8")))
      : {
          version: 1,
          language: ["ko", "ja", "en"].includes(language) ? language : "en",
          paused: false,
          workspaces: [],
          models: { claude: "", gemini: "", openai: "" },
        };
  }
  save(next) {
    validateConfig(next);
    atomic(this.file, next);
    this.config = structuredClone(next);
  }
  update(fn) {
    const next = structuredClone(this.config);
    fn(next);
    this.save(next);
  }
  workspace(id) {
    return (
      this.config.workspaces.find((w) => w.id === id) ||
      fail("workspaceMissing")
    );
  }
  audit(kind, details = {}) {
    const record = {
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      kind,
      ...details,
    };
    // Callers supply only bounded metadata, never prompts, responses or credentials.
    atomic(path.join(this.root, "activity", record.id + ".json"), record);
    return record;
  }
  activity() {
    return this.records("activity")
      .sort((a, b) => b.time.localeCompare(a.time))
      .slice(0, 200);
  }
  records(folder) {
    const dir = path.join(this.root, folder);
    if (!fs.existsSync(dir)) return [];
    noLinks(dir);
    return fs
      .readdirSync(dir)
      .filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))
      .map((n) => {
        const file = path.join(dir, n);
        noLinks(file);
        if (fs.statSync(file).size > 1024 * 1024) fail("stateInvalid");
        return JSON.parse(fs.readFileSync(file, "utf8"));
      });
  }
  backup(record) {
    atomic(path.join(this.root, "changes", record.id + ".json"), record);
  }
  changes() {
    return this.records("changes").sort((a, b) => b.time.localeCompare(a.time));
  }
}
