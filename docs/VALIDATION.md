# Validation

Validation uses generated fixtures under `codex-work/`. Personal documents and real API keys are not used. Paid provider requests are not exercised without dedicated test credentials.

## Reproduce

```sh
npm ci
node node_modules/electron/install.js
npm run check
npm test
npm run test:ui
npm audit --audit-level=moderate
```

The core suite covers path traversal, alternate streams, protected paths, root replacement, links, secret screening, transfer permissions, review/apply/restore, stale file protection, permission revocation, pause persistence, late responses, automatic edits, metadata-only logs, corrupt state, durable backup failure, concurrent requests, preview changes and byte-preserving BOM recovery.

Provider contract tests use injected HTTP responses for all three providers and verify endpoints, authentication placement, no redirects, no tools, output validation, truncation handling, response limits, model enumeration and sanitized errors. These are not live API compatibility or billing tests.

Electron automation checks real controls and file mutations, renderer Node isolation, blocked renderer networking, native OS encryption/decryption with a generated test value, Korean/Japanese/English views, review persistence across language changes, application/restoration and persistent pause. It does not automate OS folder selection or the native policy-expansion consent dialog. Native platform encryption availability is a required assertion, not silently skipped.

GitHub Actions runs the same suite on Windows x64 and macOS, packages each target and cross-builds Windows ARM64. Consult the actual workflow results before treating a platform as tested. ARM64 Windows has no execution coverage in this workflow.

No independent penetration test has been conducted. Initial distribution is not production-signed. See [SECURITY.md](../SECURITY.md) for boundaries and remaining risks.

## 2026-11-03 results

[Release validation run](https://github.com/ddossss/aegis-desk/actions/runs/41575081098), source `29918ccceb7a6009e9fe5ae50a0afe432d54afc7`:

- All 33 core/contract tests passed on Windows Server 2025 x64 and macOS 26 ARM64.
- Electron UI flows passed on both platforms, including actual OS encryption/decryption, renderer isolation, denied renderer networking, 18 language/page captures, change review, file application/restoration and pause persistence.
- A separate normal-mode test injected only native dialog responses: cancelling a permission expansion preserved the original policy and accepting updated it. This is a main-process consent-handler test, not physical clicking of the OS dialog.
- All 150 UI messages include Korean, Japanese and English translations. Source syntax/translation checks passed.
- `npm audit --audit-level=moderate` reported zero known vulnerabilities for the locked development dependency tree at validation time. This is not a guarantee of vulnerability absence.
- Windows x64, Windows ARM64 and macOS ARM64 distributions were built. Windows ARM64 is cross-built, not executed on an ARM PC.
- The local Mac also completed the suite and real read-only Gatekeeper/firewall/FileVault queries. System settings were not changed.
- No real provider API keys were supplied, so paid live Claude/Gemini/OpenAI requests remain unverified. Provider contract tests use controlled HTTP responses.

Logs, screenshots and release artifacts are in the workflow artifacts and local `codex-work/2026-11-03-build/`. The source repository excludes all local state and generated artifacts.
