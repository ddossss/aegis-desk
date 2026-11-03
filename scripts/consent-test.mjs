import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Exercise the normal main-process consent path. Only native dialog responses
// are injected; no provider or controller fixture mode is enabled.
const root = process.cwd();
const output = path.join(root, "codex-work", "consent-" + Date.now());
const folder = path.join(output, "project");
fs.mkdirSync(folder, { recursive: true });
const app = await electron.launch({
  args: [root],
  env: { ...process.env, AEGIS_TEST: "0", AEGIS_STATE: path.join(output, "state") },
});
try {
  const page = await app.firstWindow();
  await page.waitForSelector("#language");
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    dialog.showMessageBox = async () => ({ response: 0 });
  }, folder);
  const selected = await page.evaluate(() => window.aegis.call("chooseWorkspace"));
  assert.equal(selected.ok, true);
  const request = { id: selected.value.id, name: "Project", mode: "auto", allowed: ["claude"] };
  const denied = await page.evaluate(args => window.aegis.call("policy", args), request);
  assert.equal(denied.ok, false);
  assert.equal(denied.error, "cancelled");
  let state = await page.evaluate(() => window.aegis.call("snapshot"));
  assert.deepEqual(state.value.config.workspaces[0].providers, []);
  assert.equal(state.value.config.workspaces[0].mode, "review");
  assert.equal(state.value.testMode, false);
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  const approved = await page.evaluate(args => window.aegis.call("policy", args), request);
  assert.equal(approved.ok, true);
  state = await page.evaluate(() => window.aegis.call("snapshot"));
  assert.deepEqual(state.value.config.workspaces[0].providers, ["claude"]);
  assert.equal(state.value.config.workspaces[0].mode, "auto");
  console.log("PASS native-consent handler: cancel preserves policy; explicit accept updates it; fixture mode is off.");
} finally {
  await app.close();
}
