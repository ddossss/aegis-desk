import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Store, atomic } from "../core/store.mjs";
import { Controller } from "../core/controller.mjs";
import {
  safeRelative,
  readGuarded,
  rootIdentity,
  screen,
  listFiles,
  sha,
} from "../core/guard.mjs";
const base = path.resolve("codex-work/test-fixtures");
fs.mkdirSync(base, { recursive: true });
function setup() {
  const dir = fs.mkdtempSync(path.join(base, "guard-"));
  const project = path.join(dir, "project");
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, "note.md"), "Original note\n");
  const store = new Store(path.join(dir, "state"));
  const client = {
    run: async () => ({ content: "Updated note\n", summary: "Updated" }),
  };
  const controller = new Controller(store, client);
  const w = controller.addWorkspace(project);
  controller.policy(w.id, {
    name: "Project",
    mode: "review",
    allowed: ["claude"],
  });
  store.update((c) => (c.models.claude = "fixture"));
  return { dir, project, store, controller, w, client };
}
const args = (w) => ({
  workspaceId: w.id,
  provider: "claude",
  prompt: "Update the note",
  relative: "note.md",
  expectedHash: sha(fs.readFileSync(path.join(w.root, "note.md"))),
  edit: true,
  consent: true,
});
test("deny traversal, alternate data streams, hidden and secret paths", () => {
  for (const p of [
    "../note.md",
    "a/../../note.md",
    "/note.md",
    "C:/note.md",
    "a\\note.md",
    "file.md:secret",
    ".env",
    "a/.ssh/key.txt",
    "secrets.json",
    "credentials.txt",
    "foo./note.md",
    "CON.txt",
    "node_modules/a.js",
    "AGENTS.md",
    "package.json",
  ])
    assert.throws(() => safeRelative(p), undefined, p);
  assert.deepEqual(safeRelative("notes/한글 日本語.md"), [
    "notes",
    "한글 日本語.md",
  ]);
});
test("root folders and app state are blocked", () => {
  const { dir, store } = setup();
  assert.throws(() => rootIdentity(path.parse(dir).root, store.root));
  assert.throws(() => rootIdentity(store.root, store.root));
});
test("workspace identity detects replacement", () => {
  const { project, w, store } = setup();
  fs.renameSync(project, project + "-old");
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, "note.md"), "replacement");
  assert.throws(() => readGuarded(w, "note.md", store.root));
});
test("symlinks and hard links are blocked", () => {
  const { project, w, store } = setup();
  fs.symlinkSync(path.join(project, "note.md"), path.join(project, "link.md"));
  assert.throws(() => readGuarded(w, "link.md", store.root));
  fs.linkSync(path.join(project, "note.md"), path.join(project, "hard.md"));
  assert.throws(() => readGuarded(w, "note.md", store.root));
  assert.equal(listFiles(w, store.root).files.length, 0);
});
test("secret contents and non-text input are blocked", () => {
  for (const value of [
    "-----BEGIN PRIVATE KEY-----\na",
    "password=supersecret123",
    "sk-proj-" + "A".repeat(40),
    "\0",
    "x".repeat(131073),
  ])
    assert.throws(() => screen(value));
  assert.equal(screen("A normal document."), "A normal document.");
});
test("a failed secret check makes no provider request", async () => {
  const { controller, w, client } = setup();
  let called = false;
  client.run = async () => {
    called = true;
    return {};
  };
  await assert.rejects(
    controller.request({ ...args(w), prompt: "password=supersecret123" }),
  );
  assert.equal(called, false);
});
test("provider permission and explicit transfer consent are mandatory", async () => {
  const { controller, w } = setup();
  await assert.rejects(controller.request({ ...args(w), provider: "gemini" }));
  await assert.rejects(controller.request({ ...args(w), consent: false }));
});
test("review preserves the original until approved; restore round-trip", async () => {
  const { controller, w, project, store } = setup();
  const r = await controller.request(args(w));
  assert.equal(
    fs.readFileSync(path.join(project, "note.md"), "utf8"),
    "Original note\n",
  );
  const changed = controller.apply(r.proposal.id);
  assert.equal(
    fs.readFileSync(path.join(project, "note.md"), "utf8"),
    "Updated note\n",
  );
  controller.restore(changed.id);
  assert.equal(
    fs.readFileSync(path.join(project, "note.md"), "utf8"),
    "Original note\n",
  );
  assert.equal(store.changes()[0].state, "restored");
});
test("stale file proposal refuses to overwrite", async () => {
  const { controller, w, project } = setup();
  const r = await controller.request(args(w));
  fs.writeFileSync(path.join(project, "note.md"), "Changed elsewhere");
  assert.throws(() => controller.apply(r.proposal.id));
  assert.equal(
    fs.readFileSync(path.join(project, "note.md"), "utf8"),
    "Changed elsewhere",
  );
});
test("restore refuses independent changes", async () => {
  const { controller, w, project } = setup();
  const r = await controller.request(args(w)),
    c = controller.apply(r.proposal.id);
  fs.writeFileSync(path.join(project, "note.md"), "New work");
  assert.throws(() => controller.restore(c.id));
  assert.equal(
    fs.readFileSync(path.join(project, "note.md"), "utf8"),
    "New work",
  );
});
test("changing workspace permissions revokes a pending proposal", async () => {
  const { controller, w } = setup();
  const r = await controller.request(args(w));
  controller.policy(w.id, { name: "Project", mode: "review", allowed: [] });
  assert.throws(() => controller.apply(r.proposal.id));
});
test("pause is persisted, invalidates proposals, but allows restoration", async () => {
  const { controller, w, store } = setup();
  const first = await controller.request(args(w));
  const change = controller.apply(first.proposal.id);
  const second = await controller.request(args(w));
  controller.pause(true);
  assert.equal(new Store(store.root).config.paused, true);
  assert.throws(() => controller.apply(second.proposal.id));
  await assert.rejects(controller.request(args(w)));
  controller.restore(change.id);
  controller.pause(false);
  assert.equal(new Store(store.root).config.paused, false);
});
test("late provider result after pause never changes a file", async () => {
  const { controller, w, client, project } = setup();
  let release;
  client.run = () => new Promise((resolve) => (release = resolve));
  const work = controller.request(args(w));
  controller.pause(true);
  release({ content: "Malicious late write", summary: "Result" });
  await assert.rejects(work);
  assert.equal(
    fs.readFileSync(path.join(project, "note.md"), "utf8"),
    "Original note\n",
  );
});
test("automatic edits are bounded to the selected file and retain backup", async () => {
  const { controller, w, project, store } = setup();
  controller.policy(w.id, {
    name: "Project",
    mode: "auto",
    allowed: ["claude"],
  });
  const result = await controller.request(args(w));
  assert.ok(result.applied);
  assert.equal(
    fs.readFileSync(path.join(project, "note.md"), "utf8"),
    "Updated note\n",
  );
  assert.equal(store.changes()[0].before, "Original note\n");
});
test("audit does not record prompts, file content or API keys", async () => {
  const { controller, w, store } = setup();
  await controller.request({
    ...args(w),
    prompt: "private-user-prompt-marker",
  });
  const serialized = JSON.stringify(store.activity());
  assert.ok(!serialized.includes("private-user-prompt-marker"));
  assert.ok(!serialized.includes("Original note"));
  assert.ok(!serialized.includes("Updated note"));
});
test("invalid and corrupt configuration fails closed", () => {
  const { store } = setup();
  assert.throws(() =>
    store.update((c) => (c.workspaces[0].providers = ["unknown"])),
  );
  fs.writeFileSync(store.file, "broken");
  assert.throws(() => new Store(store.root));
});
test("durable journal failure prevents a write", async () => {
  const { controller, w, store, project } = setup();
  const r = await controller.request(args(w));
  store.backup = () => {
    throw new Error("disk full");
  };
  assert.throws(() => controller.apply(r.proposal.id));
  assert.equal(
    fs.readFileSync(path.join(project, "note.md"), "utf8"),
    "Original note\n",
  );
});
test("failed pause persistence remains paused in memory", () => {
  const { controller, store } = setup();
  store.update = () => {
    throw new Error("disk full");
  };
  assert.throws(() => controller.pause(true));
  assert.throws(() => controller.ensure());
});
test("concurrent requests are rejected", async () => {
  const { controller, w, client } = setup();
  let release;
  client.run = () => new Promise((resolve) => (release = resolve));
  const first = controller.request(args(w));
  await assert.rejects(controller.request(args(w)), /busy/);
  release({ content: "Done", summary: "Done" });
  await first;
});
test("atomic writes never follow destination symlinks", () => {
  const { dir } = setup();
  const target = path.join(dir, "target.json"),
    link = path.join(dir, "link.json");
  fs.writeFileSync(target, "original");
  fs.symlinkSync(target, link);
  assert.throws(() => atomic(link, { bad: true }));
  assert.equal(fs.readFileSync(target, "utf8"), "original");
});
test("files changed after preview are not uploaded", async () => {
  const { controller, w, project, client } = setup();
  const request = args(w);
  let called = false;
  client.run = async () => {
    called = true;
    return {};
  };
  fs.writeFileSync(path.join(project, "note.md"), "Changed after preview");
  await assert.rejects(controller.request(request));
  assert.equal(called, false);
});
test("UTF-8 BOM files retain byte-for-byte recovery", async () => {
  const { controller, w, project } = setup();
  const content = "\uFEFFOriginal with BOM\r\n";
  fs.writeFileSync(path.join(project, "note.md"), content);
  const result = await controller.request(args(w));
  const change = controller.apply(result.proposal.id);
  controller.restore(change.id);
  assert.equal(fs.readFileSync(path.join(project, "note.md"), "utf8"), content);
});
