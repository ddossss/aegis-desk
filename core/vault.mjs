import fs from "node:fs";
import path from "node:path";
import { atomic } from "./store.mjs";
import { providers, fail, noLinks } from "./guard.mjs";

export class Vault {
  constructor(root, backend) {
    this.file = path.join(root, "keys.json");
    this.backend = backend;
  }
  data() {
    if (!fs.existsSync(this.file)) return {};
    noLinks(this.file);
    const value = JSON.parse(fs.readFileSync(this.file, "utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      Object.values(value).some(
        (v) => typeof v !== "string" || v.length > 20000,
      )
    )
      fail("stateInvalid");
    return value;
  }
  status() {
    const data = this.data();
    return Object.fromEntries(providers.map((p) => [p, Boolean(data[p])]));
  }
  async set(provider, key) {
    if (
      !providers.includes(provider) ||
      typeof key !== "string" ||
      key.length < 8 ||
      key.length > 4096 ||
      /[\r\n]/.test(key)
    )
      fail("invalidInput");
    if (!(await this.backend.isAsyncEncryptionAvailable()))
      fail("vaultUnavailable");
    const encrypted = await this.backend.encryptStringAsync(key);
    const data = this.data();
    data[provider] = encrypted.toString("base64");
    atomic(this.file, data);
  }
  remove(provider) {
    if (!providers.includes(provider)) fail("invalidInput");
    const data = this.data();
    delete data[provider];
    atomic(this.file, data);
  }
  async get(provider) {
    if (!providers.includes(provider)) fail("invalidInput");
    const encrypted = this.data()[provider];
    if (!encrypted) fail("keyMissing");
    if (!(await this.backend.isAsyncEncryptionAvailable()))
      fail("vaultUnavailable");
    return (
      await this.backend.decryptStringAsync(Buffer.from(encrypted, "base64"))
    ).result;
  }
}
