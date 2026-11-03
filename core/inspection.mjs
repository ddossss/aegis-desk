import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { noLinks, fail } from "./guard.mjs";
const exec = promisify(execFile);
async function run(file, args) {
  try {
    const { stdout } = await exec(file, args, {
      timeout: 15000,
      maxBuffer: 65536,
      windowsHide: true,
      env: { ...process.env, LANG: "C", LC_ALL: "C" },
    });
    return stdout.trim();
  } catch {
    return null;
  }
}
export async function systemChecks() {
  const checkedAt = new Date().toISOString();
  let checks = [];
  if (process.platform === "darwin") {
    const [gatekeeper, firewall, disk] = await Promise.all([
      run("/usr/sbin/spctl", ["--status"]),
      run("/usr/libexec/ApplicationFirewall/socketfilterfw", [
        "--getglobalstate",
      ]),
      run("/usr/bin/fdesetup", ["status"]),
    ]);
    checks = [
      {
        name: "gatekeeper",
        state: gatekeeper?.includes("assessments enabled")
          ? "enabled"
          : gatekeeper?.includes("disabled")
            ? "disabled"
            : "unknown",
      },
      {
        name: "firewall",
        state: firewall?.includes("State = 1")
          ? "enabled"
          : firewall?.includes("State = 0")
            ? "disabled"
            : "unknown",
      },
      {
        name: "diskEncryption",
        state: disk?.includes("FileVault is On")
          ? "enabled"
          : disk?.includes("FileVault is Off")
            ? "disabled"
            : "unknown",
      },
    ];
  } else if (process.platform === "win32") {
    const executable = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const script =
      "$ErrorActionPreference='Stop';$d=Get-MpComputerStatus;$f=@(Get-NetFirewallProfile);if(-not $d -or $f.Count -eq 0){throw 'Unavailable'};[pscustomobject]@{antivirus=[bool]$d.AntivirusEnabled;realtime=[bool]$d.RealTimeProtectionEnabled;firewall=[bool](($f|Where-Object {-not $_.Enabled}).Count -eq 0)}|ConvertTo-Json -Compress";
    const raw = await run(executable, [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ]);
    let data;
    try {
      data = JSON.parse(raw);
    } catch {}
    checks = ["antivirus", "realtime", "firewall"].map((name) => ({
      name,
      state:
        typeof data?.[name] === "boolean"
          ? data[name]
            ? "enabled"
            : "disabled"
          : "unknown",
    }));
  } else checks = [{ name: "unsupportedOS", state: "unknown" }];
  return { checkedAt, checks };
}
export function inspectMCP(file) {
  noLinks(file);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 256 * 1024)
    fail("fileTypeBlocked");
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    fail("configInvalid");
  }
  const servers = data.mcpServers ?? data.servers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers))
    fail("configInvalid");
  return Object.entries(servers)
    .slice(0, 100)
    .map(([name, s]) => {
      if (!s || typeof s !== "object")
        return {
          name: name.slice(0, 100),
          kind: "unknown",
          host: "",
          findings: ["configInvalid"],
        };
      const findings = [];
      let host = "";
      if (s.url) {
        try {
          const u = new URL(s.url);
          host = u.hostname;
          if (u.protocol !== "https:") findings.push("insecureEndpoint");
          if (u.username || u.password || u.search)
            findings.push("embeddedCredential");
        } catch {
          findings.push("configInvalid");
        }
      }
      if (
        s.env &&
        Object.values(s.env).some(
          (v) => typeof v === "string" && v && !/^\$\{[^}]+\}$/.test(v),
        )
      )
        findings.push("inlineEnvironment");
      if (s.headers && Object.keys(s.headers).length)
        findings.push("embeddedCredential");
      if (s.command) {
        findings.push("executesCode");
        if (
          /(?:npx|uvx)/i.test(s.command) &&
          !(s.args || []).some(
            (a) => typeof a === "string" && /(?:@\d|==\d)/.test(a),
          )
        )
          findings.push("unpinnedPackage");
      }
      if (
        s.args?.some(
          (a) =>
            typeof a === "string" &&
            /--(allow-all|dangerously|no-sandbox)|\b(?:0\.0\.0\.0)\b/.test(a),
        )
      )
        findings.push("broadAccess");
      return {
        name: name.slice(0, 100),
        kind: s.command ? "local" : s.url ? "remote" : "unknown",
        host,
        findings: findings.length ? findings : ["manualReview"],
      };
    });
}
