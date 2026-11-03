# Security model

Aegis Desk 0.1 is a bounded AI file workbench with local observations. It is **not a system-wide security agent**. No independent security audit has been completed. Do not use this initial release as the sole protection for sensitive or production systems.

## Trust boundaries

The local user chooses a workspace, cloud provider and existing file. File contents and provider output are untrusted. Provider output can supply text for that selected file only; it cannot supply a filesystem path, command, URL, tool invocation or permission change. Explicit automatic editing is limited to the same selected file. Prompt-injection filtering is not the enforcement mechanism.

Main-process code enforces paths and policy. The renderer runs sandboxed with context isolation and no Node integration. Only the owning top-level file URL can invoke the validated IPC router. All remote renderer requests, navigation, extra windows, webviews, downloads and device permission requests are denied. Provider output is rendered as text, never HTML. The app exposes no local network listener and does not execute model-generated commands.

Changing provider permissions or enabling automatic edits requires a native confirmation. API calls use fixed HTTPS endpoints, bounded request/output sizes, no redirect following, and cancellation/time limits. The API keys are attached only by the main process. Keys, HTTP response bodies and prompts are not logged on error.

## Files and recovery

Workspaces cannot be filesystem roots, the home directory itself, protected system/credential locations, app state, or linked directories. Personal subfolders may be used. Hidden paths, common dependencies, credentials, agent/build configuration files, non-UTF-8 data, files over 128 KiB, symlinks and hard links are rejected. Root identity and exact file identity/size/nanosecond timestamps are checked. The preview hash must match before transfer. Identity is rechecked through an opened handle and before replacement. File reads are bounded even if a file grows concurrently.

Original content is persisted before replacement. Writes use a temporary sibling and rename. Recovery checks the current post-edit hash and refuses independent changes. Pending journals survive interruption but can require manual inspection. Restore does not run commands. Backups contain document content in local files; they are not separately encrypted. Activity logs contain only metadata, but filenames and project names can themselves be private.

Filesystem paths can still change in the small interval between the final check and rename. This app does not lock out other processes or defend against a hostile process running as the same user or administrator. Avoid concurrent edits; use operating-system isolation for hostile workloads. Generated code may perform harmful actions if the user runs it later outside this app. Cloud-synchronized file changes can propagate to other devices.

Secret-pattern detection is intentionally conservative but incomplete. It is not general data-loss prevention. A permitted provider can receive any selected content that passes screening; provider trust is a separate user decision. Pause cannot recall data already transmitted or guarantee a provider stops billing.

## Keys and state

Electron async safeStorage uses OS-backed encryption with no plaintext fallback. On Windows DPAPI does not isolate data from other processes running as the same user. On macOS the Keychain identity depends on consistent code signing; ad-hoc builds may prompt again or lose continuity between builds. Settings and journals are local, not tamper-proof against the account owner. Corrupt settings fail closed instead of resetting permissions.

The main app runs without administrator elevation. OS checks read fixed commands; user/model text is never interpolated into a shell command. Failure or insufficient privileges returns unknown, not a green pass. MCP JSON inspection never executes commands and cannot certify a server as safe.

## Distribution

Initial releases are unsigned on Windows and ad-hoc signed, not notarized, on macOS. No automatic updater is implemented. Download from the intended repository and verify checksums; checksums alone are not publisher authentication. Full signed distribution and verification are a required gate before an automatic updater or privileged security service.

No claim of protection against kernel compromise, local administrator malware, malicious trusted dependencies, compromised provider infrastructure, all prompt injection, or all data exfiltration is made. The repository's public visibility does not imply a third-party audit.

## Reporting

For non-sensitive defects, open an issue with reproduction steps and generated fixtures. Do not post API keys, private file contents or unredacted state. For sensitive findings, use GitHub private vulnerability reporting if enabled; otherwise contact the maintainer privately before disclosure.

## Primary references

- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron safeStorage and platform guarantees](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Anthropic prompt injection guidance](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks)
- [Claude Messages API](https://platform.claude.com/docs/en/api/http/messages)
- [Gemini API reference](https://ai.google.dev/api)
- [OpenAI API quickstart](https://developers.openai.com/api/docs/quickstart)
