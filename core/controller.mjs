import crypto from "node:crypto";
import path from "node:path";
import {
  rootIdentity,
  checkWorkspace,
  readGuarded,
  listFiles,
  replaceGuarded,
  providers,
  screen,
  fail,
  GuardError,
  sha,
} from "./guard.mjs";
import { validModel } from "./providers.mjs";

export class Controller {
  constructor(store, client) {
    this.store = store;
    this.client = client;
    this.active = null;
    this.proposals = new Map();
    this.epoch = 0;
  }
  ensure() {
    if (this.halted || this.store.config.paused) fail("paused");
  }
  invalidate() {
    this.epoch++;
    this.active?.abort();
    this.proposals.clear();
  }
  addWorkspace(root) {
    const identity = rootIdentity(root, this.store.root);
    if (this.store.config.workspaces.some((w) => w.root === identity.root))
      fail("alreadyAdded");
    const w = {
      id: crypto.randomUUID(),
      ...identity,
      name: path.basename(root),
      mode: "review",
      providers: [],
      revision: 0,
    };
    this.store.audit("workspaceAdded", { workspace: w.name });
    this.store.update((c) => c.workspaces.push(w));
    return w;
  }
  policy(id, { name, mode, allowed }) {
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 80 ||
      !["review", "auto"].includes(mode) ||
      !Array.isArray(allowed) ||
      allowed.some((p) => !providers.includes(p))
    )
      fail("invalidInput");
    const w = this.store.workspace(id);
    this.invalidate();
    this.store.audit("policyChanged", { workspace: w.name, mode });
    this.store.update((c) =>
      Object.assign(
        c.workspaces.find((w) => w.id === id),
        {
          name: name.trim(),
          mode,
          providers: [...new Set(allowed)],
          revision: w.revision + 1,
        },
      ),
    );
  }
  removeWorkspace(id) {
    const w = this.store.workspace(id);
    this.invalidate();
    this.store.audit("workspaceRemoved", { workspace: w.name });
    this.store.update(
      (c) => (c.workspaces = c.workspaces.filter((w) => w.id !== id)),
    );
  }
  pause(value) {
    if (typeof value !== "boolean") fail("invalidInput");
    this.invalidate();
    this.halted = true;
    this.store.update((c) => (c.paused = value));
    this.store.audit(value ? "paused" : "resumed");
    this.halted = value;
  }
  files(id) {
    return listFiles(this.store.workspace(id), this.store.root);
  }
  read(id, relative) {
    const f = readGuarded(this.store.workspace(id), relative, this.store.root);
    return { relative: f.relative, text: f.text, hash: f.hash };
  }
  async request({
    workspaceId,
    provider,
    prompt,
    relative,
    expectedHash,
    edit,
    consent,
  }) {
    this.ensure();
    if (this.active) fail("busy");
    if (
      typeof prompt !== "string" ||
      !prompt.trim() ||
      prompt.length > 12000 ||
      typeof edit !== "boolean" ||
      consent !== true
    )
      fail("invalidInput");
    screen(prompt);
    const w = this.store.workspace(workspaceId);
    checkWorkspace(w, this.store.root);
    if (!w.providers.includes(provider)) fail("providerBlocked");
    const model = validModel(this.store.config.models[provider]);
    const file = relative ? readGuarded(w, relative, this.store.root) : null;
    if (edit && !file) fail("fileRequired");
    if (file && file.hash !== expectedHash) fail("changed");
    const epoch = this.epoch,
      revision = w.revision,
      controller = new AbortController();
    this.active = controller;
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      this.store.audit("requestStarted", {
        workspace: w.name,
        provider,
        file: file?.relative || null,
        edit,
      });
      const result = await this.client.run(
        {
          provider,
          model,
          prompt,
          file,
          edit,
          language: this.store.config.language,
        },
        controller.signal,
      );
      this.ensure();
      if (
        epoch !== this.epoch ||
        controller.signal.aborted ||
        this.store.workspace(w.id).revision !== revision
      )
        fail("cancelled");
      if (!edit) {
        this.store.audit("requestFinished", { workspace: w.name, provider });
        return result;
      }
      screen(result.content);
      screen(result.summary);
      const proposal = {
        id: crypto.randomUUID(),
        workspaceId: w.id,
        revision,
        provider,
        file,
        content: result.content,
        summary: result.summary,
        epoch,
      };
      if (this.proposals.size >= 20)
        this.proposals.delete(this.proposals.keys().next().value);
      this.proposals.set(proposal.id, proposal);
      this.store.audit("proposalReady", {
        workspace: w.name,
        provider,
        file: file.relative,
      });
      if (w.mode === "auto") {
        const change = this.apply(proposal.id);
        return { text: result.summary, applied: change.id };
      }
      return {
        proposal: {
          id: proposal.id,
          relative: file.relative,
          before: file.text,
          after: result.content,
          summary: result.summary,
        },
      };
    } catch (error) {
      this.store.audit("requestFailed", {
        workspace: w.name,
        provider,
        code: error instanceof GuardError ? error.code : "operationFailed",
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      if (this.active === controller) this.active = null;
    }
  }
  discard(id) {
    this.proposals.delete(id);
  }
  apply(id) {
    this.ensure();
    const p = this.proposals.get(id);
    if (!p) fail("proposalMissing");
    const w = this.store.workspace(p.workspaceId);
    if (
      p.epoch !== this.epoch ||
      w.revision !== p.revision ||
      !w.providers.includes(p.provider)
    )
      fail("changed");
    const current = readGuarded(w, p.file.relative, this.store.root);
    if (current.hash !== p.file.hash || current.stamp !== p.file.stamp)
      fail("changed");
    const record = {
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      workspaceId: w.id,
      relative: p.file.relative,
      before: p.file.text,
      beforeHash: p.file.hash,
      afterHash: sha(p.content),
      state: "pending",
    };
    this.store.backup(record);
    this.store.audit("changeIntent", {
      change: record.id,
      workspace: w.name,
      file: p.file.relative,
    });
    replaceGuarded(w, p.file, p.content, this.store.root);
    record.state = "applied";
    this.store.backup(record);
    this.proposals.delete(id);
    this.store.audit("changeApplied", {
      change: record.id,
      workspace: w.name,
      file: p.file.relative,
    });
    return { id: record.id };
  }
  restore(id) {
    // Recovery remains available when AI work is paused.
    if (this.active) fail("busy");
    const record = this.store.changes().find((r) => r.id === id);
    if (!record || !["applied", "pending"].includes(record.state))
      fail("changeMissing");
    const w = this.store.workspace(record.workspaceId),
      current = readGuarded(w, record.relative, this.store.root);
    if (current.hash !== record.afterHash) fail("restoreConflict");
    if (sha(record.before) !== record.beforeHash) fail("stateInvalid");
    this.invalidate();
    this.store.audit("restoreIntent", {
      change: id,
      workspace: w.name,
      file: record.relative,
    });
    replaceGuarded(w, current, record.before, this.store.root);
    record.state = "restored";
    this.store.backup(record);
    this.store.audit("restored", {
      change: id,
      workspace: w.name,
      file: record.relative,
    });
  }
  changes() {
    return this.store
      .changes()
      .map(({ id, time, workspaceId, relative, state }) => ({
        id,
        time,
        workspaceId,
        relative,
        state,
      }));
  }
}
