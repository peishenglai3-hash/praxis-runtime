import { readFile, readdir } from "node:fs/promises";
import { log } from "node:console";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const workspaceDirs = ["packages", "apps"];
const sourceExtensions = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;

    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
      continue;
    }

    if (sourceExtensions.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
      files.push(entryPath);
    }
  }

  return files;
}

const packages = new Map();
for (const workspaceDir of workspaceDirs) {
  const workspacePath = join(rootDir, workspaceDir);
  const entries = await readdir(workspacePath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packagePath = join(workspacePath, entry.name);
    const packageJsonPath = join(packagePath, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    packages.set(packageJson.name, {
      directory: packagePath,
      manifest: packageJson,
    });
  }
}

const importPattern =
  /\b(?:from\s*|import\s*\(|require\s*\()\s*["'](@praxis\/[\w-]+)(?:\/[^"']*)?["']/g;
const violations = [];
let workspaceImportCount = 0;

for (const [packageName, packageInfo] of packages) {
  const files = await collectFiles(join(packageInfo.directory, "src"));
  const declared = new Set([
    ...Object.keys(packageInfo.manifest.dependencies ?? {}),
    ...Object.keys(packageInfo.manifest.devDependencies ?? {}),
    ...Object.keys(packageInfo.manifest.peerDependencies ?? {}),
  ]);

  for (const filePath of files) {
    const source = await readFile(filePath, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const importedPackage = match[1];
      if (!packages.has(importedPackage) || importedPackage === packageName)
        continue;
      workspaceImportCount += 1;
      if (!declared.has(importedPackage)) {
        violations.push(
          `${packageName} imports ${importedPackage} in ${filePath} without a declared workspace dependency`,
        );
      }
      if (
        packageInfo.manifest.dependencies?.[importedPackage] !== "workspace:*"
      ) {
        violations.push(
          `${packageName} must pin ${importedPackage} with workspace:* in dependencies`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  throw new Error(
    `Workspace dependency declarations failed:\n${violations.join("\n")}`,
  );
}

log(
  `Workspace dependency declarations OK (${packages.size} workspaces, ${workspaceImportCount} workspace imports)`,
);
