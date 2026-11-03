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
