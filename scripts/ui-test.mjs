import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../core/store.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "codex-work", "ui-" + Date.now());
fs.mkdirSync(output, { recursive: true });
const folder = path.join(output, "project");
fs.mkdirSync(folder);
fs.writeFileSync(path.join(folder, "note.md"), "Original test document.\n");
fs.writeFileSync(path.join(folder, ".env"), "DO_NOT_SEND=private");
const state = path.join(output, "state");
const app = await electron.launch({
  args: [root],
  env: { ...process.env, AEGIS_TEST: "1", AEGIS_STATE: state },
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForSelector("#language");
  const encryption = await app.evaluate(async ({ safeStorage }) => {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return false;
    const encrypted = await safeStorage.encryptStringAsync(
      "aegis-generated-test-value",
    );
    const decrypted = await safeStorage.decryptStringAsync(encrypted);
    return (
      decrypted.result === "aegis-generated-test-value" &&
      !encrypted.includes(Buffer.from("aegis-generated-test-value"))
    );
  });
  assert.equal(encryption, true, "Native OS key encryption round trip");
  const initial = await page.evaluate(() => ({
    node: typeof window.require,
    bridge: typeof window.aegis.call,
  }));
  assert.equal(initial.node, "undefined");
  assert.equal(initial.bridge, "function");
  assert.equal(
    await page.evaluate(async () => {
      try {
        await fetch("https://example.com");
        return false;
      } catch {
        return true;
      }
    }),
    true,
  );
  const w = await page.evaluate(async (folder) => {
    const r = await window.aegis.call("testWorkspace", { folder });
    if (!r.ok) throw new Error(r.error);
    return r.value;
  }, folder);
  await page.evaluate(async (id) => {
    await window.aegis.call("policy", {
      id,
      name: "Writing project",
      mode: "review",
      allowed: ["claude"],
    });
    await window.aegis.call("saveProvider", {
      provider: "claude",
      key: "",
      model: "fixture-model",
    });
  }, w.id);
  await page.reload();
  await page.waitForSelector("#language");
  for (const locale of ["ko", "ja", "en"]) {
    await page.selectOption("#language", locale);
    for (const view of [
      "overview",
      "workspaces",
      "workbench",
      "connections",
      "inspection",
      "activity",
    ]) {
      await page.locator(`[data-page="${view}"]`).click();
      await page.waitForTimeout(80);
      await page.screenshot({
        path: path.join(output, `${locale}-${view}.png`),
        fullPage: true,
      });
    }
  }
  await page.locator('[data-page="workbench"]').click();
  await page.locator('[data-file="note.md"]').click();
  assert.equal(await page.locator('[data-file=".env"]').count(), 0);
  await page.selectOption("#request-mode", "edit");
  await page.fill("#prompt", "Improve the document");
  await page.check("#consent");
  await page.click("#send");
  await page.waitForSelector("#apply");
  assert.equal(
    fs.readFileSync(path.join(folder, "note.md"), "utf8"),
    "Original test document.\n",
  );
  await page.selectOption("#language", "ja");
  await page.waitForSelector("#apply");
  assert.equal(await page.inputValue("#prompt"), "Improve the document");
  await page.screenshot({
    path: path.join(output, "ja-review.png"),
    fullPage: true,
  });
  await page.click("#apply");
  await page.waitForFunction(() =>
    document.querySelector("#toast")?.textContent.includes("復元"),
  );
  assert.ok(
    fs
      .readFileSync(path.join(folder, "note.md"), "utf8")
      .includes("Edited by the test fixture."),
  );
  await page.selectOption("#language", "en");
  await page.locator('[data-page="activity"]').click();
  await page.locator("[data-restore]").click();
  await page.locator("dialog button.primary").click();
  await page.waitForFunction(
    () => document.querySelector("#toast")?.textContent === "Restored",
  );
  assert.equal(
    fs.readFileSync(path.join(folder, "note.md"), "utf8"),
    "Original test document.\n",
  );
  await page.locator('[data-page="workbench"]').click();
  await page.locator('[data-file="note.md"]').click();
  await page.selectOption("#request-mode", "edit");
  await page.fill("#prompt", "wait");
  await page.check("#consent");
  await page.click("#send");
  await page.click("#pause");
  await page.waitForFunction(
    () => document.querySelector("#pause")?.textContent === "Resume AI work",
  );
  await page.waitForTimeout(250);
  assert.equal(
    fs.readFileSync(path.join(folder, "note.md"), "utf8"),
    "Original test document.\n",
  );
  assert.equal(new Store(state).config.paused, true);
  assert.equal(new Store(state).config.language, "en");
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, "result.txt"),
    "PASS: renderer isolation, blocked network, 18 multilingual views, review, language persistence, real file apply/restore and pause.",
  );
  console.log("PASS UI validation: " + output);
} finally {
  await app.close();
}
