# Product roadmap

## 0.1: managed AI files

Workspace/provider consent, selected-file requests, review or bounded automatic editing, protected paths and secret screening, local backups and conflict-safe restoration, encrypted API keys, trilingual UI, OS status observations, read-only MCP inspection, persistent pause and metadata history.

## Next: release hardening

Developer ID signing/notarization and Windows signing, independently reviewed threat model and penetration testing, live provider integration tests with dedicated restricted test accounts, broader OS/device coverage, explicit backup lifecycle and optional backup encryption, accessibility review and native-dialog automation.

## Later: managed command environments

A separate sandboxed runner with explicit executable/argument policy, resource limits, isolated credentials, protected workspace mounts, constrained descendants and network egress. Arbitrary shells, package-install scripts and broad developer-tool trust require a different threat model. Do not enable unrestricted execution as a shortcut.

## Later: OS-level network control

Windows filtering services and macOS Network Extension with platform entitlements. Separate minimal privileged helpers from the UI. Include health monitoring, fail-mode tests, reversible policy changes and signed update verification. Existing AI apps are outside version 0.1's coverage.

## Spacekeeper relationship

Separate repository, application identity, state folder and release train. Aegis Desk links to Spacekeeper downloads. No privileged bidirectional bridge or security-status assertion is implemented. Spacekeeper's current known-cache allowlist does not target Aegis state; do not add Aegis credentials, backups or security records to future cleaning rules.
