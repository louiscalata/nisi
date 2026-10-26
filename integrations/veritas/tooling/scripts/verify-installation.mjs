import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  canonicalJson,
  emitDeterministic,
  readJson,
  repositoryRoot,
  sha256Bytes,
  toolingRoot,
} from "./common.mjs";

const nodeModulesPath = resolve(toolingRoot, "node_modules");
const rootStat = await lstat(nodeModulesPath);
if (!rootStat.isSymbolicLink()) {
  throw new Error("Stage 5 requires an external local-runtime node_modules symlink.");
}
const rootLinkTarget = await readlink(nodeModulesPath);
if (!isAbsolute(rootLinkTarget)) {
  throw new Error("Stage 5 node_modules must use an absolute external-runtime symlink.");
}
const installedRoot = await realpath(nodeModulesPath);
const repositoryRelative = relative(repositoryRoot, installedRoot);
if (
  repositoryRelative === "" ||
  (!repositoryRelative.startsWith("..") && !isAbsolute(repositoryRelative)) ||
  !installedRoot.startsWith("/private/tmp/")
) {
  throw new Error("Stage 5 dependencies must resolve to an external /private/tmp runtime.");
}

const records = [];
let fileCount = 0;
let directoryCount = 0;
let symlinkCount = 0;
let totalBytes = 0;
let packageManifestCount = 0;

async function walk(directory, relativeDirectory = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const entry of entries) {
    const relativePath = relativeDirectory === ""
      ? entry.name
      : `${relativeDirectory}/${entry.name}`;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      directoryCount += 1;
      records.push({ path: relativePath, type: "directory" });
      await walk(absolutePath, relativePath);
      continue;
    }
    if (entry.isFile()) {
      const bytes = await readFile(absolutePath);
      fileCount += 1;
      totalBytes += bytes.byteLength;
      if (entry.name === "package.json") packageManifestCount += 1;
      records.push({
        path: relativePath,
        type: "file",
        bytes: bytes.byteLength,
        sha256: sha256Bytes(bytes),
      });
      continue;
    }
    if (entry.isSymbolicLink()) {
      const target = await readlink(absolutePath);
      const resolvedTarget = resolve(dirname(absolutePath), target);
      const targetRelative = relative(installedRoot, resolvedTarget);
      if (targetRelative === "" || targetRelative.startsWith("..") || isAbsolute(targetRelative)) {
        throw new Error(`Installed dependency symlink escapes the exact tree: ${relativePath}.`);
      }
      symlinkCount += 1;
      records.push({ path: relativePath, type: "symlink", target });
      continue;
    }
    throw new Error(`Installed dependency tree contains an unsupported entry: ${relativePath}.`);
  }
}

await walk(installedRoot);
const directVersions = {};
const toolingPackage = await readJson(resolve(toolingRoot, "package.json"));
for (const [name, expectedVersion] of Object.entries(toolingPackage.devDependencies)) {
  const installedPackage = await readJson(resolve(installedRoot, name, "package.json"));
  if (installedPackage.name !== name || installedPackage.version !== expectedVersion) {
    throw new Error(`Installed direct dependency differs: ${name}.`);
  }
  directVersions[name] = installedPackage.version;
}
const hiddenLockBytes = await readFile(resolve(installedRoot, ".package-lock.json"));
const observed = {
  rootDisposition: "EXTERNAL_ABSOLUTE_SYMLINK",
  requiredRootPrefix: "/private/tmp/",
  fileCount,
  directoryCount,
  symlinkCount,
  totalBytes,
  packageManifestCount,
  hiddenLockSha256: sha256Bytes(hiddenLockBytes),
  treeDigest: sha256Bytes(canonicalJson(records)),
  directVersions,
};
if (process.argv.includes("--observe")) {
  emitDeterministic({ schemaVersion: 1, status: "OBSERVED_NOT_VERIFIED", installation: observed });
  process.exit(0);
}
const stage5Manifest = await readJson(resolve(toolingRoot, "contracts/stage5-manifest.json"));
if (canonicalJson(observed) !== canonicalJson(stage5Manifest.installationContract)) {
  throw new Error(`Installed dependency tree differs: ${canonicalJson(observed)}.`);
}
emitDeterministic({
  schemaVersion: 1,
  status: "PASS",
  installation: observed,
  resultDigest: sha256Bytes(canonicalJson(observed)),
});
