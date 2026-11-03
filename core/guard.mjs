import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export class GuardError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export const fail = (code) => {
  throw new GuardError(code);
};
export const MAX_FILE = 128 * 1024;
export const providers = ["claude", "gemini", "openai"];
export const sha = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
export const equalPath = (a, b) =>
  process.platform === "win32"
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b);
export const within = (root, file) => {
  const relative = path.relative(root, file);
  return (
    relative !== "" &&
    !relative.startsWith(".." + path.sep) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
};
export function noLinks(file) {
  for (let part = path.resolve(file); ; part = path.dirname(part)) {
    const stat = fs.lstatSync(part);
    if (stat.isSymbolicLink()) fail("linksBlocked");
    if (path.dirname(part) === part) break;
  }
}
const excluded = new Set([
  "node_modules",
  "vendor",
  "venv",
  "__pycache__",
  "codex-work",
  "appdata",
  "library",
  "windows",
  "program files",
  "program files (x86)",
  "programdata",
  "system volume information",
]);
const sensitive =
  /(?:^|[-_.])(secret|secrets|credentials?|passwords?|tokens?|keys?|keychain|wallet|id_rsa|id_ed25519)(?:$|[-_.])/i;
const special = new Set([
  "agents.md",
  "claude.md",
  "gemini.md",
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "cargo.toml",
  "cargo.lock",
  "pyproject.toml",
  "requirements.txt",
  "makefile",
  "dockerfile",
  "justfile",
  "mcp.json",
]);
const extensions = new Set([
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".html",
  ".css",
  ".js",
  ".mjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".swift",
  ".cs",
  ".rs",
  ".go",
  ".java",
  ".sql",
]);
export function safeRelative(relative) {
  if (
    typeof relative !== "string" ||
    relative.length > 1000 ||
    path.isAbsolute(relative) ||
    /[\\:\x00-\x1f]/.test(relative)
  )
    fail("pathBlocked");
  const parts = relative.split("/");
  if (
    parts.some(
      (p) =>
        !p ||
        p === ".." ||
        p === "." ||
        p.startsWith(".") ||
        /[. ]$/.test(p) ||
        excluded.has(p.toLowerCase()) ||
        sensitive.test(p) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
    )
  )
    fail("pathBlocked");
  const name = parts.at(-1).toLowerCase();
  if (special.has(name) || !extensions.has(path.extname(name)))
    fail("fileTypeBlocked");
  return parts;
}
export function rootIdentity(root, stateRoot) {
  if (
    typeof root !== "string" ||
    !path.isAbsolute(root) ||
    root.startsWith("\\\\")
  )
    fail("rootBlocked");
  noLinks(root);
  const real = fs.realpathSync(root);
  const stat = fs.statSync(real, { bigint: true });
  if (
    !stat.isDirectory() ||
    equalPath(real, path.parse(real).root) ||
    equalPath(real, os.homedir()) ||
    equalPath(real, stateRoot) ||
    within(stateRoot, real)
  )
    fail("rootBlocked");
  if (
    real
      .split(path.sep)
      .some(
        (p) =>
          p.startsWith(".") ||
          (excluded.has(p.toLowerCase()) && p !== "codex-work"),
      )
  )
    fail("rootBlocked");
  // Test fixtures may be under codex-work, but system and credential roots remain forbidden.
  const protectedPaths =
    process.platform === "darwin"
      ? [
          "/System",
          "/Library",
          "/private",
          "/Applications",
          path.join(os.homedir(), "Library"),
        ]
      : process.platform === "win32"
        ? [
            process.env.WINDIR,
            process.env.ProgramFiles,
            process.env.ProgramData,
            process.env.LOCALAPPDATA,
            process.env.APPDATA,
          ].filter(Boolean)
        : ["/etc", "/proc", "/sys", "/dev"];
  if (protectedPaths.some((p) => equalPath(p, real) || within(p, real)))
    fail("rootBlocked");
  return { root: real, dev: stat.dev.toString(), ino: stat.ino.toString() };
}
export function checkWorkspace(workspace, stateRoot) {
  const now = rootIdentity(workspace.root, stateRoot);
  if (now.dev !== workspace.dev || now.ino !== workspace.ino) fail("changed");
}
export function screen(text) {
  if (
    typeof text !== "string" ||
    Buffer.byteLength(text) > MAX_FILE ||
    text.includes("\0")
  )
    fail("textTooLarge");
  if (
    /-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----|\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/i.test(
      text,
    ) ||
    /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|authorization)\s*[=:]\s*["']?[^\s"'<>]{8,}/i.test(
      text,
    )
  )
    fail("secretBlocked");
  return text;
}
function stamp(s) {
  return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.nlink].join(":");
}
export function readGuarded(workspace, relative, stateRoot) {
  checkWorkspace(workspace, stateRoot);
  const parts = safeRelative(relative);
  const file = path.join(workspace.root, ...parts);
  if (!within(workspace.root, file)) fail("pathBlocked");
  noLinks(file);
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > MAX_FILE)
    fail("fileTypeBlocked");
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    if (stamp(before) !== stamp(fs.fstatSync(fd, { bigint: true })))
      fail("changed");
    const buffer = Buffer.alloc(MAX_FILE + 1);
    let count = 0;
    while (count < buffer.length) {
      const n = fs.readSync(fd, buffer, count, buffer.length - count, null);
      if (!n) break;
      count += n;
    }
    if (count > MAX_FILE) fail("textTooLarge");
    const raw = buffer.subarray(0, count);
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(raw);
    if (
      stamp(before) !== stamp(fs.fstatSync(fd, { bigint: true })) ||
      stamp(before) !== stamp(fs.lstatSync(file, { bigint: true }))
    )
      fail("changed");
    screen(text);
    return {
      relative,
      text,
      hash: sha(raw),
      stamp: stamp(before),
      mode: Number(before.mode),
      file,
    };
  } finally {
    fs.closeSync(fd);
  }
}
export function listFiles(workspace, stateRoot) {
  checkWorkspace(workspace, stateRoot);
  const files = [];
  const stack = [workspace.root];
  let visited = 0,
    skipped = 0,
    truncated = false;
  while (stack.length) {
    const directory = stack.pop();
    noLinks(directory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (++visited > 10000) {
        truncated = true;
        break;
      }
      const full = path.join(directory, entry.name),
        relative = path
          .relative(workspace.root, full)
          .split(path.sep)
          .join("/");
      if (
        entry.isSymbolicLink() ||
        entry.name.startsWith(".") ||
        excluded.has(entry.name.toLowerCase()) ||
        sensitive.test(entry.name)
      ) {
        skipped++;
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      try {
        safeRelative(relative);
        const stat = fs.lstatSync(full);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_FILE) throw 0;
        files.push({ relative, size: stat.size });
      } catch {
        skipped++;
      }
    }
    if (truncated) break;
  }
  return {
    files: files.sort((a, b) => a.relative.localeCompare(b.relative)),
    skipped,
    truncated,
  };
}
export function replaceGuarded(workspace, snapshot, content, stateRoot) {
  screen(content);
  const current = readGuarded(workspace, snapshot.relative, stateRoot);
  if (current.hash !== snapshot.hash || current.stamp !== snapshot.stamp)
    fail("changed");
  const temporary = path.join(
    path.dirname(current.file),
    ".aegis-" + crypto.randomUUID() + ".tmp",
  );
  try {
    const fd = fs.openSync(temporary, "wx", current.mode & 0o777);
    try {
      fs.writeFileSync(fd, content, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const last = readGuarded(workspace, snapshot.relative, stateRoot);
    if (last.hash !== snapshot.hash || last.stamp !== snapshot.stamp)
      fail("changed");
    fs.renameSync(temporary, current.file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return readGuarded(workspace, snapshot.relative, stateRoot);
}
