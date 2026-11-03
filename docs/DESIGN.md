# Aegis Desk

Aegis means a protective shield. This is a working project name, not a trademark clearance.

The product is a separate desktop app for a single person's AI workspaces. Spacekeeper remains the disk cleaner. Version 0.1 manages only requests made inside Aegis Desk; it does not inspect or control other AI apps, shells, browsers, or system-wide network traffic.

## Visual direction

- Ink `#223349`, paper `#F7F9FC`, blue `#325DCF`, quiet blue `#EAF0FC`, caution `#A26718`, danger `#B83B4A`.
- Native humanist system type: SF Pro / Segoe UI / Korean and Japanese system fallbacks. No remote font requests.
- Left aligned desktop console. A compact navy navigation rail, a workspace selector, and an explicit boundary panel. The workspace is the dominant unit, not a synthetic security score.
- Overview uses one broad scope panel and a plain list of actual checks. Workbench uses a file list and text editor/review area. Activity is a chronological table. No decorative gradients or security theater.

```text
navigation | title and protection scope             | stop
           | workspace policy / actual system checks
           | selected files | request + response / review
```

Review: a generic dashboard of green status cards would imply coverage the app cannot provide. Replace it with an explicit managed-scope statement and separately labeled OS observations. Unknown states stay unknown. Policies are saved locally; cloud providers receive only the user's request and selected file after consent.

## First implementation

- macOS and Windows Electron app; Korean, Japanese and English.
- Read-only system checks, no administrator escalation or firewall changes.
- Workspace/provider allowlists, review-only or explicitly enabled automatic editing.
- Direct Claude, Gemini and OpenAI APIs through fixed HTTPS endpoints. No remote proxy or user-defined endpoint.
- Select one eligible existing text file per request. AI cannot choose another path, run a command, load an MCP server or change its own permissions.
- Key encryption through Electron's OS-backed asynchronous safeStorage; no plaintext fallback.
- Main-process permission checks, link checks, content screening, snapshots, durable backups, conflict-safe restore and a persistent pause switch.
- MCP configuration inspection is local and read-only. No config is executed.

## Later gates

Command execution requires a separately reviewed OS sandbox implementation with constrained descendants and network access. System-wide traffic enforcement requires platform-specific services/extensions. Signed distribution and signed update verification precede any automatic updater. No fake controls or placeholder protection claims are shown as implemented.
