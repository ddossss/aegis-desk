import { t, setLanguage, language, date } from "./i18n.js";
const app = document.querySelector("#app"),
  toast = document.querySelector("#toast");
let snapshot,
  page = "overview",
  workspaceId = "",
  files = [],
  file = null,
  result = null,
  checks = null,
  mcp = null,
  busy = false,
  requestDraft = "",
  provider = "claude",
  editing = false,
  consent = false;
const names = { claude: "Claude", gemini: "Gemini", openai: "OpenAI" };
const icons = {
  overview: "◈",
  workspaces: "▦",
  workbench: "◇",
  connections: "⇄",
  inspection: "⊞",
  activity: "◷",
};
function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "checked" || key === "disabled" || key === "value")
      node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat())
    if (child != null)
      node.append(
        typeof child === "string" ? document.createTextNode(child) : child,
      );
  return node;
}
const button = (label, action, kind = "", attributes = {}) =>
  el(
    "button",
    { type: "button", class: kind, onclick: () => safe(action), ...attributes },
    t(label),
  );
const text = (key, cls = "") => el("p", { class: cls }, t(key));
const title = (key) => el("h2", {}, t(key));
const panel = (...children) => el("section", { class: "panel" }, ...children);
function notify(message, error = false) {
  toast.textContent = message;
  toast.className = error ? "visible error" : "visible";
  setTimeout(() => (toast.className = ""), 6500);
}
async function call(method, args = {}) {
  const response = await window.aegis.call(method, args);
  if (!response.ok) throw new Error(response.error);
  return response.value;
}
async function safe(fn) {
  try {
    return await fn();
  } catch (error) {
    notify(t(error.message), true);
  }
}
async function refresh() {
  snapshot = await call("snapshot");
  setLanguage(snapshot.config.language);
  if (!snapshot.config.workspaces.some((w) => w.id === workspaceId))
    workspaceId = snapshot.config.workspaces[0]?.id || "";
  render();
}
function current() {
  return snapshot.config.workspaces.find((w) => w.id === workspaceId);
}
async function navigate(next) {
  page = next;
  if (next === "workbench" && workspaceId) await loadFiles();
  else render();
}
function empty() {
  return panel(
    el("div", { class: "empty-icon" }, "▦"),
    title("emptyWorkspace"),
    text("emptyWorkspaceBody"),
    button("addWorkspace", addWorkspace, "primary"),
  );
}
async function addWorkspace() {
  const added = await call("chooseWorkspace");
  if (added) workspaceId = added.id;
  await refresh();
}
function field(label, input, help) {
  return el(
    "label",
    { class: "field" },
    el("span", {}, t(label)),
    input,
    help ? el("small", {}, t(help)) : null,
  );
}
function select(options, value, change, attributes = {}) {
  return el(
    "select",
    {
      onchange: (event) => safe(() => change(event.target.value)),
      ...attributes,
    },
    options.map(([id, label]) =>
      el(
        "option",
        { value: id, ...(id === value ? { selected: "" } : {}) },
        label,
      ),
    ),
  );
}
function check(label, value, change, attributes = {}) {
  const input = el("input", {
    type: "checkbox",
    checked: value,
    onchange: (e) => change(e.target.checked),
    ...attributes,
  });
  return el("label", { class: "check" }, input, el("span", {}, t(label)));
}
function confirmAction(description, action) {
  const dialog = el(
    "dialog",
    { class: "confirmation" },
    title("confirmTitle"),
    text(description),
    el(
      "div",
      { class: "actions" },
      button("cancel", () => dialog.close()),
      button(
        "confirm",
        async () => {
          dialog.close();
          await action();
        },
        "primary",
      ),
    ),
  );
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
function render() {
  app.replaceChildren();
  const navigation = el(
    "nav",
    { "aria-label": "Navigation" },
    Object.keys(icons).map((key) =>
      el(
        "button",
        {
          type: "button",
          class: page === key ? "nav active" : "nav",
          onclick: () => safe(() => navigate(key)),
          "aria-current": page === key ? "page" : "false",
          "data-page": key,
        },
        el("span", { class: "nav-icon", "aria-hidden": "true" }, icons[key]),
        t(key),
      ),
    ),
  );
  const languageInput = select(
    [
      ["ko", "한국어"],
      ["ja", "日本語"],
      ["en", "English"],
    ],
    language,
    async (value) => {
      await call("language", { language: value });
      await refresh();
    },
    { "aria-label": t("language"), id: "language" },
  );
  const sidebar = el(
    "aside",
    { class: "sidebar" },
    el(
      "div",
      { class: "brand" },
      el("div", { class: "mark" }, "A"),
      el(
        "div",
        {},
        el("strong", {}, "Aegis Desk"),
        el("small", {}, t("tagline")),
      ),
    ),
    navigation,
    el(
      "div",
      { class: "sidebar-bottom" },
      field("language", languageInput),
      text("privacy"),
      button(
        "openCleaner",
        () => call("open", { target: "spacekeeper" }),
        "quiet",
      ),
    ),
  );
  const toggle = button(
    snapshot.config.paused ? "resume" : "stop",
    async () => {
      await call("pause", { value: !snapshot.config.paused });
      result = null;
      await refresh();
    },
    snapshot.config.paused ? "primary" : "stop",
    { id: "pause" },
  );
  const header = el(
    "header",
    {},
    el(
      "div",
      {},
      el("h1", {}, t(page)),
      el("span", { class: "scope-label" }, t("localBoundary")),
    ),
    toggle,
  );
  const body = el(
    "main",
    {},
    header,
    snapshot.testMode
      ? el("div", { class: "notice test" }, t("testMode"))
      : null,
    snapshot.config.paused
      ? el("div", { class: "notice pause" }, t("paused"))
      : null,
  );
  const content = {
    overview: overviewView,
    workspaces: workspacesView,
    workbench: workbenchView,
    connections: connectionsView,
    inspection: inspectionView,
    activity: activityView,
  }[page]();
  body.append(
    content,
    el(
      "footer",
      {},
      `Aegis Desk ${snapshot.version}`,
      el("span", {}, t("prototype")),
    ),
  );
  app.append(sidebar, body);
}
function overviewView() {
  const summary = el(
    "section",
    { class: "boundary" },
    el(
      "div",
      {},
      el("div", { class: "boundary-symbol", "aria-hidden": "true" }, "◇"),
      el("h2", {}, t("scopeTitle")),
      text("scopeBody"),
      button("setup", () => navigate("workspaces"), "primary"),
    ),
    el("div", { class: "boundary-foot" }, t("scopeFoot")),
  );
  const stats = el(
    "div",
    { class: "statistics" },
    [
      ["workspaceCount", snapshot.config.workspaces.length],
      ["connectionCount", Object.values(snapshot.keys).filter(Boolean).length],
      ["changeCount", snapshot.changes.length],
    ].map(([key, value]) =>
      el("div", {}, el("strong", {}, String(value)), el("span", {}, t(key))),
    ),
  );
  const checkSection = panel(
    el(
      "div",
      { class: "section-head" },
      el("div", {}, title("checks"), text("checkHelp", "muted")),
      button(
        "checkNow",
        async () => {
          checks = await call("checks");
          render();
        },
        "",
        { id: "check-system" },
      ),
    ),
    checks
      ? el(
          "div",
          { class: "check-results" },
          checks.checks.map((c) =>
            el(
              "div",
              { class: "check-result" },
              el("span", {}, t(c.name)),
              el("span", { class: "badge " + c.state }, t(c.state)),
            ),
          ),
          el("small", { class: "muted" }, date(checks.checkedAt)),
        )
      : text("notChecked", "muted"),
  );
  return el("div", {}, summary, stats, checkSection);
}
function workspacesView() {
  const content = el(
    "div",
    {},
    el(
      "div",
      { class: "section-head" },
      text("workspaceHelp", "lead"),
      button("addWorkspace", addWorkspace, "primary", { id: "add-workspace" }),
    ),
  );
  if (!snapshot.config.workspaces.length) {
    content.append(empty());
    return content;
  }
  for (const w of snapshot.config.workspaces) {
    let mode = w.mode,
      allowed = [...w.providers];
    const name = el("input", {
      value: w.name,
      maxlength: 80,
      "aria-label": t("name"),
    });
    const permissions = el(
      "fieldset",
      {},
      el("legend", {}, t("allowed")),
      Object.entries(names).map(([id, name]) =>
        check(
          name,
          allowed.includes(id),
          (value) => {
            allowed = value
              ? [...new Set([...allowed, id])]
              : allowed.filter((p) => p !== id);
          },
          { "data-provider": id },
        ),
      ),
    );
    const policy = select(
      [
        ["review", t("review")],
        ["auto", t("auto")],
      ],
      mode,
      (value) => {
        mode = value;
      },
      { "aria-label": t("editing") },
    );
    content.append(
      panel(
        el(
          "div",
          { class: "workspace-heading" },
          el("span", { class: "workspace-icon" }, "▦"),
          el(
            "div",
            {},
            el("h2", {}, w.name),
            el("p", { class: "path" }, w.root),
          ),
        ),
        el(
          "div",
          { class: "policy-grid" },
          field("name", name),
          field("editing", policy, "autoHelp"),
          permissions,
        ),
        el(
          "div",
          { class: "actions" },
          button(
            "save",
            async () => {
              await call("policy", {
                id: w.id,
                name: name.value,
                mode,
                allowed,
              });
              result = null;
              await refresh();
              notify(t("saved"));
            },
            "primary",
            { "data-save-policy": w.id },
          ),
          button(
            "remove",
            () =>
              confirmAction("removeHelp", async () => {
                await call("removeWorkspace", { id: w.id });
                file = null;
                files = [];
                result = null;
                await refresh();
              }),
            "quiet danger",
          ),
        ),
      ),
    );
  }
  return content;
}
function connectionsView() {
  const content = el(
    "div",
    {},
    text("connectionHelp", "lead"),
    el("div", { class: "notice" }, t("vaultNote")),
  );
  for (const [id, name] of Object.entries(names)) {
    const key = el("input", {
        type: "password",
        placeholder: t("keyPlaceholder"),
        autocomplete: "off",
        spellcheck: "false",
        "aria-label": `${name} ${t("key")}`,
      }),
      model = el("input", {
        value: snapshot.config.models[id],
        placeholder: t("modelHint"),
        spellcheck: "false",
        "aria-label": `${name} ${t("model")}`,
      }),
      modelList = el("div", { class: "model-list" });
    content.append(
      panel(
        el(
          "div",
          { class: "section-head" },
          el("h2", {}, name),
          el(
            "span",
            { class: "badge " + (snapshot.keys[id] ? "enabled" : "unknown") },
            t(snapshot.keys[id] ? "keySaved" : "keyMissingLabel"),
          ),
        ),
        el(
          "div",
          { class: "connection-grid" },
          field("key", key),
          field("model", model),
        ),
        modelList,
        el(
          "div",
          { class: "actions" },
          button(
            "save",
            async () => {
              await call("saveProvider", {
                provider: id,
                key: key.value,
                model: model.value.trim(),
              });
              key.value = "";
              await refresh();
              notify(t("saved"));
            },
            "primary",
          ),
          button("fetchModels", async () => {
            const models = await call("models", { provider: id });
            modelList.replaceChildren(
              select(
                [["", t("modelHint")], ...models.map((m) => [m, m])],
                model.value,
                (value) => (model.value = value),
                { "aria-label": `${name} models` },
              ),
            );
          }),
          button("getKey", () => call("open", { target: id }), "quiet"),
          button(
            "deleteKey",
            async () => {
              await call("removeKey", { provider: id });
              await refresh();
            },
            "quiet danger",
            { disabled: !snapshot.keys[id] },
          ),
        ),
      ),
    );
  }
  return content;
}
async function loadFiles() {
  file = null;
  result = null;
  files = workspaceId ? await call("files", { id: workspaceId }) : [];
  render();
}
function workbenchView() {
  if (!workspaceId) return empty();
  const w = current();
  const picker = select(
    snapshot.config.workspaces.map((w) => [w.id, w.name]),
    workspaceId,
    async (id) => {
      workspaceId = id;
      await loadFiles();
    },
    { "aria-label": t("selectWorkspace"), id: "workspace-select" },
  );
  const fileButtons = el(
    "div",
    { class: "file-list" },
    button(
      "noFile",
      () => {
        file = null;
        result = null;
        render();
      },
      !file ? "selected" : "",
    ),
    ...(files.files || []).map((f) =>
      el(
        "button",
        {
          type: "button",
          class: file?.relative === f.relative ? "selected" : "",
          onclick: () =>
            safe(async () => {
              file = await call("read", {
                id: workspaceId,
                relative: f.relative,
              });
              result = null;
              render();
            }),
          "data-file": f.relative,
          title: f.relative,
        },
        f.relative,
        el("small", {}, `${Math.ceil(f.size / 1024)} KB`),
      ),
    ),
  );
  const list = el(
    "section",
    { class: "file-pane" },
    field("selectWorkspace", picker),
    el(
      "div",
      { class: "section-head" },
      el("h3", {}, t("chooseFile")),
      button("refreshFiles", loadFiles, "icon-button"),
    ),
    fileButtons,
    files.truncated ? text("partial", "notice") : null,
    text("fileHelp", "muted"),
  );
  const controls = el(
    "div",
    { class: "work-controls" },
    field(
      "connections",
      select(Object.entries(names), provider, (value) => (provider = value), {
        "aria-label": t("connections"),
        id: "provider-select",
      }),
    ),
    field(
      "editing",
      select(
        [
          ["ask", t("ask")],
          ["edit", t("edit")],
        ],
        editing ? "edit" : "ask",
        (value) => {
          editing = value === "edit";
        },
        { "aria-label": t("editing"), id: "request-mode" },
      ),
    ),
  );
  const prompt = el("textarea", {
    rows: 4,
    maxlength: 12000,
    placeholder: t("promptPlaceholder"),
    value: requestDraft,
    oninput: (e) => (requestDraft = e.target.value),
    id: "prompt",
  });
  const consentCheck = check("consent", consent, (value) => (consent = value), {
    id: "consent",
  });
  const send = button(
    "send",
    async () => {
      if (!consent) throw new Error("invalidInput");
      busy = true;
      result = null;
      render();
      try {
        result = await call("request", {
          workspaceId,
          provider,
          prompt: requestDraft,
          relative: file?.relative || null,
          expectedHash: file?.hash,
          edit: editing,
          consent,
        });
        if (result.applied)
          file = await call("read", {
            id: workspaceId,
            relative: file.relative,
          });
      } finally {
        busy = false;
        await refresh();
      }
    },
    "primary",
    { id: "send", disabled: busy || snapshot.config.paused },
  );
  const editor = el(
    "section",
    { class: "editor" },
    el(
      "div",
      { class: "editor-meta" },
      el("strong", {}, file?.relative || t("noFile")),
      el("span", { class: "badge" }, t(w.mode)),
    ),
    controls,
    field("prompt", prompt),
    consentCheck,
    el("div", { class: "actions" }, send, busy ? text("working") : null),
  );
  if (result?.proposal) {
    const p = result.proposal;
    editor.append(
      el(
        "div",
        { class: "proposal" },
        el("h3", {}, t("after")),
        el("p", {}, p.summary),
        el(
          "div",
          { class: "diff" },
          field(
            "before",
            el("textarea", { readonly: "", value: p.before, rows: 10 }),
          ),
          field(
            "after",
            el("textarea", { readonly: "", value: p.after, rows: 10 }),
          ),
        ),
        el(
          "div",
          { class: "actions" },
          button(
            "apply",
            async () => {
              await call("apply", { id: p.id });
              result = null;
              file = await call("read", {
                id: workspaceId,
                relative: p.relative,
              });
              await refresh();
              notify(t("applied"));
            },
            "primary",
            { id: "apply" },
          ),
          button("discard", async () => {
            await call("discard", { id: p.id });
            result = null;
            render();
          }),
        ),
      ),
    );
  } else if (result) {
    editor.append(
      el(
        "section",
        { class: "response" },
        el("h3", {}, t(result.applied ? "applied" : "response")),
        el("pre", {}, result.text || ""),
      ),
    );
  } else if (file) {
    editor.append(
      el(
        "details",
        {},
        el("summary", {}, t("before")),
        el("pre", { class: "file-preview" }, file.text),
      ),
    );
  } else editor.append(text("requestIdle", "muted"));
  return el(
    "div",
    {},
    text("workbenchHelp", "lead"),
    el("div", { class: "workbench" }, list, editor),
  );
}
function inspectionView() {
  return el(
    "div",
    {},
    text("inspectHelp", "lead"),
    button(
      "chooseConfig",
      async () => {
        mcp = await call("inspectMCP");
        render();
      },
      "primary",
    ),
    ...(mcp || []).map((s) =>
      panel(
        el(
          "div",
          { class: "section-head" },
          el("h2", {}, s.name),
          el("span", { class: "badge" }, t(s.kind)),
        ),
        s.host ? el("p", { class: "path" }, s.host) : null,
        el(
          "ul",
          { class: "findings" },
          s.findings.map((f) => el("li", {}, t(f))),
        ),
      ),
    ),
  );
}
function activityView() {
  const content = el(
    "div",
    {},
    text("activityHelp", "lead"),
    panel(
      el(
        "div",
        { class: "section-head" },
        title("changes"),
        button("openState", () => call("openState"), "quiet"),
      ),
    ),
  );
  const changes = content.lastChild;
  for (const c of snapshot.changes) {
    const name =
      snapshot.config.workspaces.find((w) => w.id === c.workspaceId)?.name ||
      "—";
    changes.append(
      el(
        "div",
        { class: "change-row" },
        el(
          "div",
          {},
          el("strong", {}, c.relative),
          el("small", {}, `${name} · ${date(c.time)}`),
        ),
        el(
          "span",
          { class: "badge" },
          t(c.state === "applied" ? "changeApplied" : c.state),
        ),
        c.state !== "restored"
          ? button(
              "restore",
              () =>
                confirmAction("restoreHelp", async () => {
                  await call("restore", { id: c.id });
                  await refresh();
                  notify(t("restored"));
                }),
              "",
              { "data-restore": c.id },
            )
          : null,
      ),
    );
  }
  if (!snapshot.changes.length) changes.append(text("emptyActivity", "muted"));
  const rows = snapshot.activity.map((a) =>
    el(
      "tr",
      {},
      el("td", {}, date(a.time)),
      el("td", {}, t(a.kind)),
      el("td", {}, a.workspace || names[a.provider] || ""),
      el("td", { class: "path" }, a.file || ""),
    ),
  );
  content.append(
    panel(
      title("events"),
      rows.length
        ? el(
            "div",
            { class: "table-scroll" },
            el("table", {}, el("tbody", {}, rows)),
          )
        : text("emptyActivity", "muted"),
    ),
  );
  return content;
}
await safe(refresh);
