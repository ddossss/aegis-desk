# Aegis Desk

**[한국어](README.ko.md) · [日本語](README.ja.md) · English**

A personal desktop workspace for Claude, Gemini and OpenAI, with explicit file permissions, change review and recovery. Aegis means a protective shield. Aegis Desk is a separate project from [Spacekeeper](https://github.com/ddossss/spacekeeper).

**Version 0.1 is an early personal release, not antivirus, a system-wide firewall, an OS sandbox, or a security guarantee.** Permissions cover requests made inside this app. Other AI apps, browsers and shells remain outside its control. Read [SECURITY.md](SECURITY.md) before enabling automatic editing.

## Download and run

Get the matching ZIP from [Releases](https://github.com/ddossss/aegis-desk/releases). On macOS, extract and open **Aegis Desk.app**. On Windows, extract the entire ZIP into a permanent folder and open **Aegis Desk.exe**. Keep all files together. No Node.js installation is needed for packaged apps.

The initial Mac build is ad-hoc signed, not Developer ID signed or notarized. Windows builds are unsigned. Do not disable system security features to run the app. ARM64 Windows builds are cross-compiled; use the validation notes for actual execution coverage.

## First use

1. Choose 한국어, 日本語 or English in the sidebar.
2. Add an individual project folder under **Workspaces**. Cloud providers are disabled initially.
3. Enable the providers allowed to receive selected files. Broadening permissions requires a native confirmation. Start with **Review before applying**.
4. Under **AI connections**, save your own API key. You can leave the model blank initially, then list available models, select one and save again. Chat subscriptions and API billing may be separate.
5. In **AI workbench**, select a file, write your request and confirm transfer to the chosen provider. Ask questions or request a complete-file edit.
6. Inspect the current/proposed text before applying. Restore from **Activity & recovery** if the file has not changed since that edit.

## Implemented

| Feature             | Actual behavior                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace policy    | Explicit project/provider allowlists; review mode by default; optional automatic edits restricted to the user-selected existing file                                   |
| File boundary       | UTF-8 text up to 128 KiB; protected paths, hidden files, links, common credential paths and agent/build configuration files excluded                                   |
| Request boundary    | Only the user's request and selected file sent to a fixed provider HTTPS endpoint; no AI tools, commands, dynamic URLs or MCP execution                                |
| API keys            | OS-backed asynchronous Electron safeStorage encryption, no plaintext fallback; keys never returned by the IPC bridge                                                   |
| Change recovery     | Main-process checks, precise file identity/time snapshots, preview hash validation, durable original-content backups, stale-file refusal and conflict-safe restoration |
| Emergency pause     | Cancels this app's pending AI request, invalidates proposals and persists the paused state; recovery remains available                                                 |
| System observations | macOS Gatekeeper, application firewall and FileVault; Windows Defender and firewall status; unknown results remain unknown                                             |
| MCP inspection      | User-selected JSON only; flags insecure URLs, inline credentials, local execution, unpinned packages and broad options without executing servers                       |
| Local activity      | Metadata-only operation records; prompts, responses and file contents omitted from the activity log                                                                    |
| Three languages     | Korean, Japanese and English, including errors and policy/recovery flows                                                                                               |

System checks do not change settings. Secret-pattern screening can miss secrets and produce false positives. Read-only observations are not a complete posture assessment. Editing executable source can affect later executions outside Aegis Desk; review generated code before running it elsewhere.

## Data and privacy

There is no telemetry, Aegis cloud service or background upload. Requests require a permitted workspace/provider and an explicit send action. API calls go directly to `api.anthropic.com`, `generativelanguage.googleapis.com`, or `api.openai.com`. Provider processing/retention policies still apply. OpenAI requests set `store:false`; this is not a promise of zero provider retention.

Packaged state uses the OS app-data folder: `~/Library/Application Support/Aegis Desk` on macOS and `%APPDATA%\Aegis Desk` on Windows. Development state lives in `codex-work/state`. The app includes a button to open its actual state folder.

- `settings.json`: language, pause state, project permissions and model IDs.
- `keys.json`: encrypted API-key values.
- `activity/`: operation metadata, including relative file paths.
- `changes/`: original file contents for recovery. These are local files protected by filesystem permissions, **not encrypted backups**. Retain them while recovery is needed; removing the state folder removes recovery history.

The renderer never receives stored keys and cannot make network requests. The main process authenticates IPC frames and rechecks policy. No HTTP listener, command executor, autoupdater or privileged service is installed.

## Development

Node.js 24 or newer and Python 3 are needed for development/packaging.

```sh
npm ci
node node_modules/electron/install.js  # if npm blocked dependency install scripts
npm run check
npm test
npm run test:ui
npm start
```

```sh
npm run package:mac          # Apple Silicon; run on macOS
npm run package:win          # Windows x64 ZIP
npm run package:win-arm64    # Windows ARM64 ZIP
```

All generated outputs are under `codex-work/`. Packaging copies only `app/`, `core/`, `ui/` and a minimal package manifest into the official Electron distribution. No dev dependencies, personal state, test fixtures or credentials are shipped. Electron downloads are checked by `@electron/get`; distribution ZIPs include SHA-256 files.

Unit tests use isolated fixtures and injected provider responses. Electron UI tests drive actual controls, native key encryption, file apply/restore and three languages. They do not call paid APIs. `AEGIS_TEST=1` only works in an unpackaged development launch and shows a prominent test banner; packaged apps ignore it.

See [design](docs/DESIGN.md), [threat model](SECURITY.md), [validation](docs/VALIDATION.md) and [roadmap](docs/ROADMAP.md). No claim is made of independent security certification or penetration testing.
