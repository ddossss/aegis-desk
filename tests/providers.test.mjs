import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ProviderClient, endpoints } from "../core/providers.mjs";
import { Vault } from "../core/vault.mjs";
import { inspectMCP } from "../core/inspection.mjs";
const vault = { get: async () => "test-key-value" };
const response = (value) =>
  new Response(JSON.stringify(value), { status: 200 });
for (const provider of Object.keys(endpoints)) {
  test(
    provider + " only uses its fixed endpoint and correct API request",
    async () => {
      const client = new ProviderClient(vault, async (url, options) => {
        assert.equal(new URL(url).origin, endpoints[provider]);
        assert.equal(options.redirect, "error");
        assert.ok(!url.includes("test-key-value"));
        const body = JSON.parse(options.body);
        assert.equal(body.tools, undefined);
        if (provider === "openai") {
          assert.equal(body.store, false);
          return response({
            status: "completed",
            output: [
              { content: [{ type: "output_text", text: "A response" }] },
            ],
          });
        }
        if (provider === "claude")
          return response({
            stop_reason: "end_turn",
            content: [{ type: "text", text: "A response" }],
          });
        return response({
          candidates: [
            {
              finishReason: "STOP",
              content: { parts: [{ text: "A response" }] },
            },
          ],
        });
      });
      assert.equal(
        (
          await client.run(
            {
              provider,
              model: "test-model",
              prompt: "Hello",
              edit: false,
              language: "en",
            },
            new AbortController().signal,
          )
        ).text,
        "A response",
      );
    },
  );
}
test("invalid model cannot inject URL paths or query strings", async () => {
  let called = false;
  const client = new ProviderClient(vault, async () => {
    called = true;
  });
  await assert.rejects(
    client.run({
      provider: "gemini",
      model: "a/b?key=foo",
      prompt: "hi",
      language: "en",
    }),
  );
  assert.equal(called, false);
});
test("provider errors are sanitized and do not echo remote content", async () => {
  const client = new ProviderClient(
    vault,
    async () => new Response("test-key-value", { status: 401 }),
  );
  await assert.rejects(
    client.run({
      provider: "openai",
      model: "test",
      prompt: "hi",
      language: "en",
    }),
    (e) => e.message === "apiAuth",
  );
});
test("editing response rejects unexpected file path and permission fields", async () => {
  const client = new ProviderClient(vault, async () =>
    response({
      status: "completed",
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                summary: "bad",
                content: "x",
                path: "../outside",
              }),
            },
          ],
        },
      ],
    }),
  );
  await assert.rejects(
    client.run({
      provider: "openai",
      model: "test",
      prompt: "hi",
      edit: true,
      language: "en",
    }),
    /responseInvalid/,
  );
});
test("truncated responses are not applied", async () => {
  const client = new ProviderClient(vault, async () =>
    response({ status: "incomplete", output: [] }),
  );
  await assert.rejects(
    client.run({
      provider: "openai",
      model: "test",
      prompt: "hi",
      edit: true,
      language: "en",
    }),
    /responseIncomplete/,
  );
});
test("oversized provider responses are rejected", async () => {
  const client = new ProviderClient(
    vault,
    async () => new Response("x".repeat(1024 * 1024 + 1)),
  );
  await assert.rejects(
    client.run({
      provider: "openai",
      model: "test",
      prompt: "hi",
      edit: false,
      language: "en",
    }),
    /responseInvalid/,
  );
});
test("model enumeration normalizes Gemini names and excludes non-generation models", async () => {
  const client = new ProviderClient(vault, async () =>
    response({
      models: [
        {
          name: "models/gemini-test",
          supportedGenerationMethods: ["generateContent"],
        },
        {
          name: "models/embedding",
          supportedGenerationMethods: ["embedContent"],
        },
      ],
    }),
  );
  assert.deepEqual(await client.models("gemini"), ["gemini-test"]);
});
const base = path.resolve("codex-work/test-fixtures");
fs.mkdirSync(base, { recursive: true });
test("vault refuses plaintext fallback and supports encrypted round trip/removal", async () => {
  const dir = fs.mkdtempSync(path.join(base, "vault-"));
  let available = false;
  const backend = {
    isAsyncEncryptionAvailable: async () => available,
    encryptStringAsync: async (value) =>
      Buffer.from([...value].reverse().join("")),
    decryptStringAsync: async (value) => ({
      result: [...value.toString()].reverse().join(""),
    }),
  };
  const v = new Vault(dir, backend);
  await assert.rejects(v.set("claude", "private-test-key"));
  assert.equal(fs.existsSync(v.file), false);
  available = true;
  await v.set("claude", "private-test-key");
  assert.ok(!fs.readFileSync(v.file, "utf8").includes("private-test-key"));
  assert.equal(await v.get("claude"), "private-test-key");
  v.remove("claude");
  assert.equal(v.status().claude, false);
});
test("MCP inspection reports risky settings without returning credentials or executing code", () => {
  const dir = fs.mkdtempSync(path.join(base, "mcp-")),
    file = path.join(dir, "config.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      mcpServers: {
        local: {
          command: "npx",
          args: ["package", "--no-sandbox"],
          env: { SECRET: "do-not-display" },
        },
        remote: {
          url: "http://example.com?token=do-not-display",
          headers: { Authorization: "do-not-display" },
        },
      },
    }),
  );
  const result = inspectMCP(file);
  assert.ok(result[0].findings.includes("unpinnedPackage"));
  assert.ok(result[0].findings.includes("broadAccess"));
  assert.ok(result[1].findings.includes("insecureEndpoint"));
  assert.ok(!JSON.stringify(result).includes("do-not-display"));
});
