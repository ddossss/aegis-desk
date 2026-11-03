import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { downloadArtifact } from "@electron/get";
const [platform = process.platform, arch = process.arch] =
  process.argv.slice(2);
if (!["darwin", "win32"].includes(platform) || !["x64", "arm64"].includes(arch))
  throw new Error("Supported targets: darwin/win32 and x64/arm64");
const root = process.cwd(),
  pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const dist = path.join(root, "codex-work", "dist");
fs.mkdirSync(dist, { recursive: true });
const target = path.join(dist, `Aegis-Desk-${platform}-${arch}`);
// Only replace this generated distribution directory, never project or user data.
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
const archive = await downloadArtifact({
  version: pkg.devDependencies.electron,
  artifactName: "electron",
  platform,
  arch,
  cacheRoot: path.join(root, "codex-work", "electron-cache"),
});
const python = process.platform === "win32" ? "python" : "python3";
execFileSync(
  python,
  [
    "-c",
    "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",
    archive,
    target,
  ],
  { stdio: "inherit" },
);
let resources;
if (platform === "darwin") {
  if (process.platform !== "darwin")
    throw new Error(
      "Build Mac bundles on macOS to preserve framework links and modes",
    );
  // Python extraction does not preserve symlinks. ditto does.
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  execFileSync("/usr/bin/ditto", ["-x", "-k", archive, target]);
  fs.renameSync(
    path.join(target, "Electron.app"),
    path.join(target, "Aegis Desk.app"),
  );
  const bundle = path.join(target, "Aegis Desk.app");
  resources = path.join(bundle, "Contents", "Resources");
  for (const [key, value] of [
    ["CFBundleDisplayName", "Aegis Desk"],
    ["CFBundleName", "Aegis Desk"],
    ["CFBundleIdentifier", "app.aegisdesk.desktop"],
    ["CFBundleShortVersionString", pkg.version],
    ["CFBundleVersion", pkg.version],
  ])
    execFileSync("/usr/libexec/PlistBuddy", [
      "-c",
      `Set :${key} ${value}`,
      path.join(bundle, "Contents", "Info.plist"),
    ]);
} else {
  fs.renameSync(
    path.join(target, "electron.exe"),
    path.join(target, "Aegis Desk.exe"),
  );
  resources = path.join(target, "resources");
}
fs.rmSync(path.join(resources, "default_app.asar"), { force: true });
const app = path.join(resources, "app");
fs.mkdirSync(app, { recursive: true });
for (const folder of ["app", "core", "ui"])
  fs.cpSync(path.join(root, folder), path.join(app, folder), {
    recursive: true,
  });
fs.writeFileSync(
  path.join(app, "package.json"),
  JSON.stringify({
    name: pkg.name,
    version: pkg.version,
    main: pkg.main,
    type: "module",
    description: pkg.description,
  }),
);
for (const name of ["README.md", "SECURITY.md"])
  if (fs.existsSync(name)) fs.copyFileSync(name, path.join(target, name));
const zip = path.join(
  dist,
  `Aegis-Desk-${pkg.version}-${platform}-${arch}.zip`,
);
fs.rmSync(zip, { force: true });
if (platform === "darwin") {
  execFileSync(
    "/usr/bin/codesign",
    ["--force", "--deep", "--sign", "-", path.join(target, "Aegis Desk.app")],
    { stdio: "inherit" },
  );
  execFileSync("/usr/bin/ditto", [
    "-c",
    "-k",
    "--sequesterRsrc",
    "--keepParent",
    path.join(target, "Aegis Desk.app"),
    zip,
  ]);
} else
  execFileSync(
    python,
    [
      "-c",
      'import shutil,sys; shutil.make_archive(sys.argv[1],"zip",sys.argv[2])',
      zip.slice(0, -4),
      target,
    ],
    { stdio: "inherit" },
  );
const hash = crypto
  .createHash("sha256")
  .update(fs.readFileSync(zip))
  .digest("hex");
fs.writeFileSync(zip + ".sha256", hash + "  " + path.basename(zip) + "\n");
console.log(zip + "\nSHA-256 " + hash);
