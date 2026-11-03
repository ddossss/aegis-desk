const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  session,
  shell,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
app.setName("Aegis Desk");
const development = !app.isPackaged;
const testMode = development && process.env.AEGIS_TEST === "1";
const root = path.resolve(__dirname, "..");
const state = development
  ? path.resolve(
      process.env.AEGIS_STATE || path.join(root, "codex-work", "state"),
    )
  : app.getPath("userData");
app.setPath("userData", state);
if (!app.requestSingleInstanceLock()) app.quit();
let window, controller, store, vault, client;
const pageURL = pathToFileURL(path.join(root, "ui", "index.html")).href;
const external = {
  electron: "https://www.electronjs.org/docs/latest/tutorial/security",
  claude: "https://console.anthropic.com/",
  gemini: "https://aistudio.google.com/apikey",
  openai: "https://platform.openai.com/api-keys",
  spacekeeper: "https://github.com/ddossss/spacekeeper/releases",
};
function trusted(event) {
  return (
    window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame.url === pageURL
  );
}
app
  .whenReady()
  .then(async () => {
    const [
      { Store },
      { Vault },
      { Controller },
      { ProviderClient },
      { systemChecks, inspectMCP },
      { GuardError, fail, providers },
    ] = await Promise.all(
      ["store", "vault", "controller", "providers", "inspection", "guard"].map(
        (n) => import(pathToFileURL(path.join(root, "core", n + ".mjs")).href),
      ),
    );
    store = new Store(state, app.getLocale().split("-")[0]);
    vault = new Vault(state, safeStorage);
    client = new ProviderClient(vault);
    controller = new Controller(store, client);
    if (testMode) {
      // Explicit development-only fixture: never used by a packaged app or a normal launch.
      client.run = async ({ prompt, file, edit }, signal) => {
        if (prompt === "wait")
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, 3000);
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(t);
                reject(new GuardError("cancelled"));
              },
              { once: true },
            );
          });
        return edit
          ? {
              summary: "Fixture revision",
              content: file.text + "\nEdited by the test fixture.\n",
            }
          : { text: "Fixture response" };
      };
      client.models = async () => ["fixture-model"];
    }
    const serial = { busy: false };
    const actions = {
      snapshot: () => ({
        config: store.config,
        keys: vault.status(),
        changes: controller.changes(),
        activity: store.activity(),
        platform: process.platform,
        version: app.getVersion(),
        testMode,
      }),
      language: ({ language }) => {
        if (!["ko", "ja", "en"].includes(language)) fail("invalidInput");
        store.update((c) => (c.language = language));
      },
      chooseWorkspace: async () => {
        const result = await dialog.showOpenDialog(window, {
          properties: ["openDirectory"],
        });
        if (!result.canceled)
          return controller.addWorkspace(result.filePaths[0]);
      },
      policy: async ({ id, name, mode, allowed }) => {
        const previous = store.workspace(id);
        if (!Array.isArray(allowed)) fail("invalidInput");
        if (
          !testMode &&
          (allowed.some((p) => !previous.providers.includes(p)) ||
            (mode === "auto" && previous.mode !== "auto"))
        ) {
          const messages = {
            ko: [
              "작업 권한 변경",
              "이 프로젝트에서 선택한 파일의 AI 전송 또는 자동 수정을 허용할까요?",
              "허용",
              "취소",
            ],
            ja: [
              "作業権限の変更",
              "このプロジェクトで選択ファイルのAI送信または自動編集を許可しますか？",
              "許可",
              "キャンセル",
            ],
            en: [
              "Change workspace permissions",
              "Allow AI transfer or automatic editing of selected files in this project?",
              "Allow",
              "Cancel",
            ],
          }[store.config.language];
          const answer = await dialog.showMessageBox(window, {
            type: "question",
            title: messages[0],
            message: messages[1],
            detail: previous.root + "\n" + allowed.join(", ") + "\n" + mode,
            buttons: [messages[3], messages[2]],
            defaultId: 0,
            cancelId: 0,
          });
          if (answer.response !== 1) fail("cancelled");
        }
        return controller.policy(id, { name, mode, allowed });
      },
      removeWorkspace: ({ id }) => controller.removeWorkspace(id),
      files: ({ id }) => controller.files(id),
      read: ({ id, relative }) => controller.read(id, relative),
      pause: ({ value }) => controller.pause(value),
      request: (args) => controller.request(args),
      apply: ({ id }) => controller.apply(id),
      discard: ({ id }) => controller.discard(id),
      restore: ({ id }) => controller.restore(id),
      saveProvider: async ({ provider, key, model }) => {
        if (
          !providers.includes(provider) ||
          typeof model !== "string" ||
          (model !== "" && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,149}$/.test(model))
        )
          fail("modelMissing");
        controller.invalidate();
        if (key) await vault.set(provider, key);
        controller.invalidate();
        store.audit("providerSaved", { provider });
        store.update((c) => (c.models[provider] = model));
      },
      removeKey: ({ provider }) => {
        controller.invalidate();
        vault.remove(provider);
        store.audit("keyRemoved", { provider });
      },
      models: async ({ provider }) => {
        controller.ensure();
        return client.models(provider, AbortSignal.timeout(20000));
      },
      checks: () => systemChecks(),
      inspectMCP: async () => {
        const result = await dialog.showOpenDialog(window, {
          properties: ["openFile"],
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (result.canceled) return null;
        const results = inspectMCP(result.filePaths[0]);
        store.audit("mcpInspected", { count: results.length });
        return results;
      },
      open: ({ target }) => {
        if (!Object.hasOwn(external, target)) fail("invalidInput");
        return shell.openExternal(external[target]);
      },
      openState: () => shell.openPath(store.root),
    };
    if (testMode)
      actions.testWorkspace = ({ folder }) => controller.addWorkspace(folder);
    ipcMain.handle("aegis", async (event, method, args = {}) => {
      if (
        !trusted(event) ||
        typeof method !== "string" ||
        !Object.hasOwn(actions, method)
      )
        return { ok: false, error: "accessDenied" };
      try {
        if (
          !args ||
          typeof args !== "object" ||
          Array.isArray(args) ||
          JSON.stringify(args).length > 200000
        )
          fail("invalidInput");
        const exclusive = [
          "saveProvider",
          "removeKey",
          "policy",
          "removeWorkspace",
          "chooseWorkspace",
          "language",
        ].includes(method);
        if (exclusive && serial.busy) fail("busy");
        if (exclusive) serial.busy = true;
        try {
          return { ok: true, value: await actions[method](args) };
        } finally {
          if (exclusive) serial.busy = false;
        }
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof GuardError
              ? error.code
              : error?.name === "AbortError"
                ? "cancelled"
                : "operationFailed",
        };
      }
    });
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.on("will-download", (event) =>
      event.preventDefault(),
    );
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
      (_details, callback) => callback({ cancel: true }),
    );
    window = new BrowserWindow({
      width: 1320,
      height: 900,
      minWidth: 1080,
      minHeight: 720,
      backgroundColor: "#F7F9FC",
      title: "Aegis Desk",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        devTools: development,
        spellcheck: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    window.on("close", () => controller.invalidate());
    app.on("second-instance", () => {
      if (window) {
        if (window.isMinimized()) window.restore();
        window.focus();
      }
    });
    await window.loadFile(path.join(root, "ui", "index.html"));
  })
  .catch((error) => {
    dialog.showErrorBox(
      "Aegis Desk",
      "Could not start safely. Existing state has not been reset.\n" +
        (error.code || "operationFailed"),
    );
    app.exit(1);
  });
app.on("window-all-closed", () => app.quit());
