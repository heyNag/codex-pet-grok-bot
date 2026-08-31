import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, execFileSync, spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(root, "install.sh");
const sourceBase = pathToFileURL(root).href.replace(/\/$/, "");
const receiptName = ".codex-pet-grok-bot-receipt";
const sourceRef = "7083db88e073ac11b73ead06a50c677ba30d638b";
const realMv = execFileSync("/bin/sh", ["-c", "command -v mv"], {
  encoding: "utf8",
}).trim();
const realSync = execFileSync("/bin/sh", ["-c", "command -v sync"], {
  encoding: "utf8",
}).trim();
const transactionJournalKeys = [
  "schema",
  "project",
  "phase",
  "release",
  "source_ref",
  "codex_root",
  "stage_root",
  "backup_run",
  "dark_state",
  "dark_backup",
  "dark_manifest_sha256",
  "dark_spritesheet_sha256",
  "light_state",
  "light_backup",
  "light_manifest_sha256",
  "light_spritesheet_sha256",
];

const variants = {
  dark: {
    id: "grok-bot-dark",
    name: "Grok Bot Dark",
    manifestSha: "d969b71040a5e2b8939eb50bb4463729ae8797f08ad97105c8cf5ba98f4f5be0",
    spriteSha: "ee2f30d37bb5356152d910ff1ffbf79246b5b7aedf284f88a8ecf6c0bd91d1d4",
  },
  light: {
    id: "grok-bot-light",
    name: "Grok Bot Light",
    manifestSha: "ca9cfa7e77a53719a031bc77e514b78766bb3b52fa2ca2c7c0d271f404fb46d1",
    spriteSha: "14e07d0bd9cb552c2b6bdbe8bf3aff98deb37adb16ed5c9cf5922f6831039314",
  },
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const pathExists = async (candidate) => {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};

const makeFixture = async (context, prefix) => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), prefix));
  context.after(() => rm(fixture, { recursive: true, force: true }));
  return fixture;
};

const runInstaller = (
  codexHome,
  args,
  {
    source = sourceBase,
    defaultHome = false,
    env: extraEnv = {},
    pathPrefix,
  } = {},
) => new Promise((resolve, reject) => {
  const env = {
    ...process.env,
    ...extraEnv,
    GROK_BOT_INSTALL_SOURCE_BASE: source,
  };

  if (defaultHome) {
    delete env.CODEX_HOME;
    env.HOME = codexHome;
  } else {
    env.CODEX_HOME = codexHome;
  }
  if (pathPrefix) env.PATH = `${pathPrefix}${path.delimiter}${env.PATH}`;

  execFile("/bin/sh", [installer, ...args], { env }, (error, stdout, stderr) => {
    if (error) reject(Object.assign(error, { stdout, stderr }));
    else resolve({ stdout, stderr });
  });
});

const expectFailure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("expected installer to fail");
};

const targetPath = (codexHome, variant) => (
  path.join(codexHome, "pets", variants[variant].id)
);

const sourcePath = (variant, file) => (
  path.join(root, "pet", variants[variant].id, file)
);

const expectedReceipt = (
  variant,
  {
    release = "1.0.0",
    ref = sourceRef,
    manifestSha = variants[variant].manifestSha,
    spriteSha = variants[variant].spriteSha,
  } = {},
) => [
  "schema=1",
  "project=heyNag/codex-pet-grok-bot",
  `variant=${variant}`,
  `pet_id=${variants[variant].id}`,
  `release=${release}`,
  `source_ref=${ref}`,
  `pet_json_sha256=${manifestSha}`,
  `spritesheet_sha256=${spriteSha}`,
  "",
].join("\n");

const assertBundleMatches = async (codexHome, variant) => {
  const target = targetPath(codexHome, variant);
  for (const file of ["pet.json", "spritesheet.webp"]) {
    assert.deepEqual(
      await readFile(path.join(target, file)),
      await readFile(sourcePath(variant, file)),
    );
  }
  assert.equal(
    await readFile(path.join(target, receiptName), "utf8"),
    expectedReceipt(variant),
  );
};

const copyCurrentBundle = async (codexHome, variant) => {
  const target = targetPath(codexHome, variant);
  await mkdir(target, { recursive: true });
  for (const file of ["pet.json", "spritesheet.webp"]) {
    await copyFile(sourcePath(variant, file), path.join(target, file));
  }
  return target;
};

const writeOwnedStaleBundle = async (codexHome, variant) => {
  const target = await copyCurrentBundle(codexHome, variant);
  const staleManifest = Buffer.concat([
    await readFile(path.join(target, "pet.json")),
    Buffer.from("\n"),
  ]);
  const sprite = await readFile(path.join(target, "spritesheet.webp"));
  await writeFile(path.join(target, "pet.json"), staleManifest);
  await writeFile(
    path.join(target, receiptName),
    expectedReceipt(variant, {
      release: "0.9.0",
      ref: "previous-release",
      manifestSha: sha256(staleManifest),
      spriteSha: sha256(sprite),
    }),
  );
  return {
    manifest: staleManifest,
    receipt: await readFile(path.join(target, receiptName)),
    sprite,
  };
};

const makeSourceFixture = async (context, variant) => {
  const fixture = await makeFixture(context, `grok-installer-${variant}-source-`);
  const pet = path.join(fixture, "pet", variants[variant].id);
  await mkdir(pet, { recursive: true });
  for (const file of ["pet.json", "spritesheet.webp"]) {
    await copyFile(sourcePath(variant, file), path.join(pet, file));
  }
  return { fixture, pet, url: pathToFileURL(fixture).href.replace(/\/$/, "") };
};

const assertNoTransientArtifacts = async (codexHome) => {
  const entries = await readdir(codexHome);
  assert.deepEqual(
    entries.filter((entry) => (
      entry === ".codex-pet-grok-bot.lock"
      || entry.startsWith(".codex-pet-grok-bot.stage.")
    )),
    [],
  );
};

const runInstallerProcess = (
  codexHome,
  args,
  {
    env: extraEnv = {},
    pathPrefix,
    source = sourceBase,
  } = {},
) => new Promise((resolve, reject) => {
  const env = {
    ...process.env,
    ...extraEnv,
    CODEX_HOME: codexHome,
    GROK_BOT_INSTALL_SOURCE_BASE: source,
  };
  if (pathPrefix) env.PATH = `${pathPrefix}${path.delimiter}${env.PATH}`;

  const child = spawn("/bin/sh", [installer, ...args], { env });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("error", reject);
  child.once("close", (code, signal) => {
    resolve({ code, pid: child.pid, signal, stderr, stdout });
  });
});

const readStrictTransactionJournal = async (journalPath) => {
  const journalText = await readFile(journalPath, "utf8");
  const lines = journalText.trimEnd().split("\n");
  const keys = lines.map((line) => line.slice(0, line.indexOf("=")));
  assert.deepEqual(keys, transactionJournalKeys);
  assert.equal(new Set(keys).size, 16);
  return Object.fromEntries(lines.map((line) => {
    const separator = line.indexOf("=");
    assert.notEqual(separator, -1);
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
};

const expectedOwnedMarker = (ownedPath) => (
  `schema=1\nproject=heyNag/codex-pet-grok-bot\npath=${ownedPath}\n`
);

test("dark installs only the dark pet and writes the complete ownership receipt", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-dark-");

  const result = await runInstaller(fixture, ["dark"]);

  assert.match(result.stdout, /Installed Grok Bot Dark/);
  assert.match(result.stdout, /Settings > Pets/);
  assert.equal(result.stderr, "");
  await assertBundleMatches(fixture, "dark");
  assert.equal(await pathExists(targetPath(fixture, "light")), false);
  await assertNoTransientArtifacts(fixture);
});

test("light installs only the light pet", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-light-");

  const result = await runInstaller(fixture, ["light"]);

  assert.match(result.stdout, /Installed Grok Bot Light/);
  assert.equal(result.stderr, "");
  await assertBundleMatches(fixture, "light");
  assert.equal(await pathExists(targetPath(fixture, "dark")), false);
  await assertNoTransientArtifacts(fixture);
});

test("both installs two independently identified pets in one transaction", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-both-");

  const result = await runInstaller(fixture, ["both"]);

  assert.match(result.stdout, /Installed Grok Bot Dark/);
  assert.match(result.stdout, /Installed Grok Bot Light/);
  await assertBundleMatches(fixture, "dark");
  await assertBundleMatches(fixture, "light");
  await assertNoTransientArtifacts(fixture);
});

test("an exact managed installation is a no-op and does not contact the source", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-current-");
  await runInstaller(fixture, ["dark"]);
  const target = targetPath(fixture, "dark");
  const before = {
    manifest: await lstat(path.join(target, "pet.json")),
    receipt: await lstat(path.join(target, receiptName)),
    sprite: await lstat(path.join(target, "spritesheet.webp")),
  };

  const result = await runInstaller(fixture, ["dark"], {
    source: "file:///this/source/does/not/exist",
  });

  assert.match(result.stdout, /Grok Bot Dark is already up to date/);
  assert.equal((await lstat(path.join(target, "pet.json"))).ino, before.manifest.ino);
  assert.equal((await lstat(path.join(target, receiptName))).ino, before.receipt.ino);
  assert.equal((await lstat(path.join(target, "spritesheet.webp"))).ino, before.sprite.ino);
  assert.equal(await pathExists(path.join(fixture, "pet-backups")), false);
  await assertBundleMatches(fixture, "dark");
  await assertNoTransientArtifacts(fixture);
});

test("an exact manual bundle is adopted without replacing or downloading assets", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-adopt-");
  const target = await copyCurrentBundle(fixture, "light");
  const before = {
    manifest: await lstat(path.join(target, "pet.json")),
    sprite: await lstat(path.join(target, "spritesheet.webp")),
  };

  const result = await runInstaller(fixture, ["light"], {
    source: "file:///this/source/does/not/exist",
  });

  assert.match(result.stdout, /Registered the existing current Grok Bot Light installation/);
  assert.equal((await lstat(path.join(target, "pet.json"))).ino, before.manifest.ino);
  assert.equal((await lstat(path.join(target, "spritesheet.webp"))).ino, before.sprite.ino);
  await assertBundleMatches(fixture, "light");
  assert.equal(await pathExists(path.join(fixture, "pet-backups")), false);
  await assertNoTransientArtifacts(fixture);
});

test("the one-argument command updates an owned stale pet and removes its transaction backup", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-sync-update-");
  await writeOwnedStaleBundle(fixture, "dark");

  const result = await runInstaller(fixture, ["dark"]);

  assert.match(result.stdout, /Updated Grok Bot Dark/);
  await assertBundleMatches(fixture, "dark");
  assert.deepEqual((await readdir(path.join(fixture, "pets"))).sort(), [variants.dark.id]);
  assert.equal(await pathExists(path.join(fixture, "pet-backups")), false);
  await assertNoTransientArtifacts(fixture);
});

test("updating both variants leaves exactly one active directory for each pet ID", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-both-update-");
  await writeOwnedStaleBundle(fixture, "dark");
  await writeOwnedStaleBundle(fixture, "light");

  const result = await runInstaller(fixture, ["both"]);

  assert.match(result.stdout, /Updated Grok Bot Dark/);
  assert.match(result.stdout, /Updated Grok Bot Light/);
  assert.deepEqual(
    (await readdir(path.join(fixture, "pets"))).sort(),
    [variants.dark.id, variants.light.id],
  );
  await assertBundleMatches(fixture, "dark");
  await assertBundleMatches(fixture, "light");
  assert.equal(await pathExists(path.join(fixture, "pet-backups")), false);
  await assertNoTransientArtifacts(fixture);
});

test("explicit update refuses a missing pet without leaving a lock or stage", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-update-missing-");

  const error = await expectFailure(runInstaller(fixture, ["update", "light"]));

  assert.match(error.stderr, /Grok Bot Light is not installed/);
  assert.equal(await pathExists(targetPath(fixture, "light")), false);
  assert.deepEqual(await readdir(path.join(fixture, "pets")), []);
  await assertNoTransientArtifacts(fixture);
});

test("an unmanaged conflicting directory is refused without changing it", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-unmanaged-");
  const target = targetPath(fixture, "dark");
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "keep.txt"), "do not replace");

  const error = await expectFailure(runInstaller(fixture, ["dark"]));

  assert.match(error.stderr, /is unmanaged, locally modified, or contains unexpected files/);
  assert.equal(await readFile(path.join(target, "keep.txt"), "utf8"), "do not replace");
  assert.deepEqual(await readdir(target), ["keep.txt"]);
  assert.equal(await pathExists(path.join(fixture, "pet-backups")), false);
  await assertNoTransientArtifacts(fixture);
});

test("a locally modified managed pet is refused and remains byte-for-byte modified", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-modified-");
  await runInstaller(fixture, ["light"]);
  const target = targetPath(fixture, "light");
  const modified = Buffer.concat([
    await readFile(path.join(target, "spritesheet.webp")),
    Buffer.from("local edit"),
  ]);
  const receipt = await readFile(path.join(target, receiptName));
  await writeFile(path.join(target, "spritesheet.webp"), modified);

  const error = await expectFailure(runInstaller(fixture, ["light"]));

  assert.match(error.stderr, /is unmanaged, locally modified, or contains unexpected files/);
  assert.deepEqual(await readFile(path.join(target, "spritesheet.webp")), modified);
  assert.deepEqual(await readFile(path.join(target, receiptName)), receipt);
  assert.equal(await pathExists(path.join(fixture, "pet-backups")), false);
  await assertNoTransientArtifacts(fixture);
});

test("a symlinked pet target is refused without touching its destination", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-target-link-");
  const outside = await makeFixture(context, "grok-installer-outside-");
  await mkdir(path.join(fixture, "pets"), { recursive: true });
  await writeFile(path.join(outside, "sentinel"), "untouched");
  await symlink(outside, targetPath(fixture, "light"));

  const error = await expectFailure(runInstaller(fixture, ["light"]));

  assert.match(error.stderr, /refusing to replace symlinked target/);
  assert.equal(await readFile(path.join(outside, "sentinel"), "utf8"), "untouched");
  await assertNoTransientArtifacts(fixture);
});

test("a symlinked receipt is not trusted even when the pet assets are current", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-receipt-link-");
  const outside = await makeFixture(context, "grok-installer-receipt-outside-");
  const target = await copyCurrentBundle(fixture, "dark");
  const outsideReceipt = path.join(outside, "receipt");
  await writeFile(outsideReceipt, expectedReceipt("dark"));
  await symlink(outsideReceipt, path.join(target, receiptName));

  const error = await expectFailure(runInstaller(fixture, ["dark"]));

  assert.match(error.stderr, /is not an exact unmodified installer-managed bundle/);
  assert.equal(await readFile(outsideReceipt, "utf8"), expectedReceipt("dark"));
  assert.equal((await lstat(path.join(target, receiptName))).isSymbolicLink(), true);
  await assertNoTransientArtifacts(fixture);
});

test("duplicate receipt fields cannot authorize an update", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-duplicate-receipt-");
  const target = await copyCurrentBundle(fixture, "dark");
  await writeFile(
    path.join(target, receiptName),
    `${expectedReceipt("dark")}release=forged\n`,
  );

  const error = await expectFailure(runInstaller(fixture, ["dark"]));

  assert.match(error.stderr, /is not an exact unmodified installer-managed bundle/);
  assert.match(
    await readFile(path.join(target, receiptName), "utf8"),
    /release=forged/,
  );
  await assertNoTransientArtifacts(fixture);
});

test("a managed receipt cannot authorize a manifest with the wrong pet ID", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-wrong-manifest-id-");
  const target = await copyCurrentBundle(fixture, "light");
  const wrongManifest = Buffer.from(
    (await readFile(path.join(target, "pet.json"), "utf8"))
      .replace('"id": "grok-bot-light"', '"id": "someone-else"'),
  );
  const sprite = await readFile(path.join(target, "spritesheet.webp"));
  await writeFile(path.join(target, "pet.json"), wrongManifest);
  await writeFile(
    path.join(target, receiptName),
    expectedReceipt("light", {
      release: "previous-release",
      ref: "previous-release",
      manifestSha: sha256(wrongManifest),
      spriteSha: sha256(sprite),
    }),
  );

  const error = await expectFailure(runInstaller(fixture, ["light"]));

  assert.match(error.stderr, /is unmanaged, locally modified, or contains unexpected files/);
  assert.deepEqual(await readFile(path.join(target, "pet.json")), wrongManifest);
  await assertNoTransientArtifacts(fixture);
});

test("unexpected files make a managed bundle locally modified and are preserved", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-extra-file-");
  await runInstaller(fixture, ["dark"]);
  const target = targetPath(fixture, "dark");
  await writeFile(path.join(target, "local-notes.txt"), "keep this");

  const error = await expectFailure(runInstaller(fixture, ["dark"]));

  assert.match(error.stderr, /is not an exact unmodified installer-managed bundle/);
  assert.equal(await readFile(path.join(target, "local-notes.txt"), "utf8"), "keep this");
  await assertNoTransientArtifacts(fixture);
});

test("a size verification failure installs nothing and removes staging state", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-size-home-");
  const source = await makeSourceFixture(context, "dark");
  await writeFile(
    path.join(source.pet, "pet.json"),
    Buffer.concat([await readFile(path.join(source.pet, "pet.json")), Buffer.from(" ")]),
  );

  const error = await expectFailure(runInstaller(fixture, ["dark"], { source: source.url }));

  assert.match(error.stderr, /size verification failed for pet\.json/);
  assert.equal(await pathExists(targetPath(fixture, "dark")), false);
  assert.deepEqual(await readdir(path.join(fixture, "pets")), []);
  await assertNoTransientArtifacts(fixture);
});

test("a same-size checksum failure installs nothing and removes staging state", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-checksum-home-");
  const source = await makeSourceFixture(context, "light");
  const manifestPath = path.join(source.pet, "pet.json");
  const corrupted = await readFile(manifestPath);
  corrupted[0] ^= 1;
  await writeFile(manifestPath, corrupted);

  const error = await expectFailure(runInstaller(fixture, ["light"], { source: source.url }));

  assert.match(error.stderr, /checksum verification failed for pet\.json/);
  assert.equal(await pathExists(targetPath(fixture, "light")), false);
  assert.deepEqual(await readdir(path.join(fixture, "pets")), []);
  await assertNoTransientArtifacts(fixture);
});

test("both preflights every target before adopting or downloading either pet", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-preflight-");
  const darkTarget = await copyCurrentBundle(fixture, "dark");
  const darkManifest = await lstat(path.join(darkTarget, "pet.json"));
  const lightTarget = targetPath(fixture, "light");
  await mkdir(lightTarget, { recursive: true });
  await writeFile(path.join(lightTarget, "sentinel"), "keep me");

  const error = await expectFailure(runInstaller(fixture, ["both"], {
    source: "file:///this/source/does/not/exist",
  }));

  assert.match(error.stderr, /grok-bot-light is unmanaged, locally modified, or contains unexpected files/);
  assert.equal(await pathExists(path.join(darkTarget, receiptName)), false);
  assert.equal((await lstat(path.join(darkTarget, "pet.json"))).ino, darkManifest.ino);
  assert.equal(await readFile(path.join(lightTarget, "sentinel"), "utf8"), "keep me");
  assert.equal(await pathExists(path.join(fixture, "pet-backups")), false);
  await assertNoTransientArtifacts(fixture);
});

test("a target created during the final rename is preserved without nesting the pet", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-late-collision-");
  const canonicalFixture = await realpath(fixture);
  const stubDirectory = await makeFixture(context, "grok-installer-collision-stub-");
  const marker = path.join(stubDirectory, "created-once");
  const target = targetPath(canonicalFixture, "dark");
  const stub = path.join(stubDirectory, "mv");
  await writeFile(stub, [
    "#!/bin/sh",
    "if [ \"$#\" -eq 2 ] && [ \"$2\" = \"$GROK_BOT_TEST_COLLISION_TARGET\" ] && [ ! -e \"$GROK_BOT_TEST_COLLISION_MARKER\" ]; then",
    "  mkdir -p \"$2\"",
    "  printf '%s\\n' 'keep this collision' > \"$2/sentinel\"",
    "  : > \"$GROK_BOT_TEST_COLLISION_MARKER\"",
    "fi",
    "exec \"$GROK_BOT_TEST_REAL_MV\" \"$@\"",
    "",
  ].join("\n"));
  await chmod(stub, 0o700);

  const error = await expectFailure(runInstaller(fixture, ["dark"], {
    pathPrefix: stubDirectory,
    env: {
      GROK_BOT_TEST_COLLISION_MARKER: marker,
      GROK_BOT_TEST_COLLISION_TARGET: target,
      GROK_BOT_TEST_REAL_MV: realMv,
    },
  }));

  assert.match(error.stderr, /could not install Grok Bot Dark without replacing an unexpected destination/);
  assert.equal(await readFile(path.join(target, "sentinel"), "utf8"), "keep this collision\n");
  assert.deepEqual(await readdir(target), ["sentinel"]);
  assert.equal(await pathExists(marker), true);
  await assertNoTransientArtifacts(fixture);
});

test("CODEX_HOME may be an absolute path containing spaces", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-space-parent-");
  const codexHome = path.join(fixture, "Codex Home With Spaces");

  const result = await runInstaller(codexHome, ["dark"]);

  assert.match(result.stdout, new RegExp(codexHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await assertBundleMatches(codexHome, "dark");
  await assertNoTransientArtifacts(codexHome);
});

test("HOME/.codex is used when CODEX_HOME is unset", async (context) => {
  const home = await makeFixture(context, "grok-installer-default-home-");
  const codexHome = path.join(home, ".codex");

  await runInstaller(home, ["light"], { defaultHome: true });

  await assertBundleMatches(codexHome, "light");
  assert.equal(await pathExists(path.join(home, "pets")), false);
  await assertNoTransientArtifacts(codexHome);
});

test("a pre-existing lock is preserved and blocks a second installer", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-locked-");
  const lock = path.join(fixture, ".codex-pet-grok-bot.lock");
  await mkdir(lock);
  await writeFile(path.join(lock, "owner"), "another process");

  const error = await expectFailure(runInstaller(fixture, ["dark"]));

  assert.match(error.stderr, /another Grok Bot installation may be running/);
  assert.equal(await readFile(path.join(lock, "owner"), "utf8"), "another process");
  assert.equal(await pathExists(targetPath(fixture, "dark")), false);
  assert.deepEqual(await readdir(path.join(fixture, "pets")), []);
});

test("failure placing the second pet rolls both stale pets back and cleans transaction state", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-rollback-");
  const canonicalFixture = await realpath(fixture);
  const stubDirectory = await makeFixture(context, "grok-installer-stub-");
  const staleDark = await writeOwnedStaleBundle(fixture, "dark");
  const staleLight = await writeOwnedStaleBundle(fixture, "light");
  const marker = path.join(stubDirectory, "failed-once");
  const stub = path.join(stubDirectory, "mv");
  await writeFile(stub, [
    "#!/bin/sh",
    "if [ \"$#\" -eq 2 ] && [ \"$2\" = \"$GROK_BOT_TEST_FAIL_MV_TARGET\" ] && [ ! -e \"$GROK_BOT_TEST_FAIL_MV_MARKER\" ]; then",
    "  : > \"$GROK_BOT_TEST_FAIL_MV_MARKER\"",
    "  exit 91",
    "fi",
    "exec \"$GROK_BOT_TEST_REAL_MV\" \"$@\"",
    "",
  ].join("\n"));
  await chmod(stub, 0o700);

  const error = await expectFailure(runInstaller(fixture, ["both"], {
    pathPrefix: stubDirectory,
    env: {
      GROK_BOT_TEST_FAIL_MV_MARKER: marker,
      GROK_BOT_TEST_FAIL_MV_TARGET: targetPath(canonicalFixture, "light"),
      GROK_BOT_TEST_REAL_MV: realMv,
    },
  }));

  assert.match(error.stderr, /could not place the updated Grok Bot Light installation/);
  assert.equal(await pathExists(marker), true);
  for (const [variant, stale] of [["dark", staleDark], ["light", staleLight]]) {
    const target = targetPath(fixture, variant);
    assert.deepEqual(await readFile(path.join(target, "pet.json")), stale.manifest);
    assert.deepEqual(await readFile(path.join(target, "spritesheet.webp")), stale.sprite);
    assert.deepEqual(await readFile(path.join(target, receiptName)), stale.receipt);
  }
  assert.equal(await pathExists(path.join(fixture, "pet-backups")), false);
  await assertNoTransientArtifacts(fixture);
});

test("an interrupt immediately after renaming the old pet restores it", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-interrupt-");
  const canonicalFixture = await realpath(fixture);
  const stubDirectory = await makeFixture(context, "grok-installer-interrupt-stub-");
  const stale = await writeOwnedStaleBundle(fixture, "light");
  const marker = path.join(stubDirectory, "interrupted-once");
  const stub = path.join(stubDirectory, "mv");
  await writeFile(stub, [
    "#!/bin/sh",
    "if [ \"$#\" -eq 2 ] && [ \"$1\" = \"$GROK_BOT_TEST_INTERRUPT_SOURCE\" ] && [ ! -e \"$GROK_BOT_TEST_INTERRUPT_MARKER\" ]; then",
    "  \"$GROK_BOT_TEST_REAL_MV\" \"$@\" || exit $?",
    "  : > \"$GROK_BOT_TEST_INTERRUPT_MARKER\"",
    "  kill -TERM \"$PPID\"",
    "  exit 0",
    "fi",
    "exec \"$GROK_BOT_TEST_REAL_MV\" \"$@\"",
    "",
  ].join("\n"));
  await chmod(stub, 0o700);

  await expectFailure(runInstaller(fixture, ["light"], {
    pathPrefix: stubDirectory,
    env: {
      GROK_BOT_TEST_INTERRUPT_MARKER: marker,
      GROK_BOT_TEST_INTERRUPT_SOURCE: targetPath(canonicalFixture, "light"),
      GROK_BOT_TEST_REAL_MV: realMv,
    },
  }));

  const target = targetPath(fixture, "light");
  assert.equal(await pathExists(marker), true);
  assert.deepEqual(await readFile(path.join(target, "pet.json")), stale.manifest);
  assert.deepEqual(await readFile(path.join(target, "spritesheet.webp")), stale.sprite);
  assert.deepEqual(await readFile(path.join(target, receiptName)), stale.receipt);
  assert.equal(await pathExists(path.join(fixture, "pet-backups")), false);
  await assertNoTransientArtifacts(fixture);
});

test("a SIGKILL after the old pet rename is journal-recovered by the next update", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-sigkill-");
  const canonicalFixture = await realpath(fixture);
  const stubDirectory = await makeFixture(context, "grok-installer-sigkill-stub-");
  const stale = await writeOwnedStaleBundle(fixture, "dark");
  const oldTarget = targetPath(canonicalFixture, "dark");
  const marker = path.join(stubDirectory, "killed-after-backup-rename");
  const stub = path.join(stubDirectory, "mv");
  await writeFile(stub, [
    "#!/bin/sh",
    "if [ \"$#\" -eq 2 ] && [ \"$1\" = \"$GROK_BOT_TEST_KILL_SOURCE\" ] && [ ! -e \"$GROK_BOT_TEST_KILL_MARKER\" ]; then",
    "  case \"$2\" in",
    "    \"$GROK_BOT_TEST_BACKUP_ROOT\"/.grok-bot-transaction-*/.previous-grok-bot-dark-*)",
    "      \"$GROK_BOT_TEST_REAL_MV\" \"$@\" || exit $?",
    "      : > \"$GROK_BOT_TEST_KILL_MARKER\"",
    "      kill -KILL \"$PPID\"",
    "      exit 0",
    "      ;;",
    "  esac",
    "fi",
    "exec \"$GROK_BOT_TEST_REAL_MV\" \"$@\"",
    "",
  ].join("\n"));
  await chmod(stub, 0o700);

  const crash = await new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      CODEX_HOME: fixture,
      GROK_BOT_INSTALL_SOURCE_BASE: sourceBase,
      GROK_BOT_TEST_BACKUP_ROOT: path.join(canonicalFixture, "pet-backups"),
      GROK_BOT_TEST_KILL_MARKER: marker,
      GROK_BOT_TEST_KILL_SOURCE: oldTarget,
      GROK_BOT_TEST_REAL_MV: realMv,
      PATH: `${stubDirectory}${path.delimiter}${process.env.PATH}`,
    };
    const child = spawn("/bin/sh", [installer, "dark"], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code, pid: child.pid, signal, stderr, stdout });
    });
  });

  assert.equal(crash.code, null);
  assert.equal(crash.signal, "SIGKILL");
  assert.equal(await pathExists(marker), true);
  assert.throws(() => process.kill(crash.pid, 0), { code: "ESRCH" });
  assert.equal(await pathExists(oldTarget), false);

  const lock = path.join(canonicalFixture, ".codex-pet-grok-bot.lock");
  const ownerPath = path.join(lock, "owner");
  const journalPath = path.join(lock, "transaction-journal");
  assert.deepEqual((await readdir(lock)).sort(), ["owner", "transaction-journal"]);
  assert.equal((await lstat(ownerPath)).isFile(), true);
  assert.equal((await lstat(journalPath)).isFile(), true);
  assert.equal(
    await readFile(ownerPath, "utf8"),
    `project=heyNag/codex-pet-grok-bot\npid=${crash.pid}\n`,
  );

  const journalText = await readFile(journalPath, "utf8");
  const journalLines = journalText.trimEnd().split("\n");
  const journalKeys = journalLines.map((line) => line.slice(0, line.indexOf("=")));
  assert.deepEqual(journalKeys, transactionJournalKeys);
  assert.equal(new Set(journalKeys).size, 16);
  const journal = Object.fromEntries(journalLines.map((line) => {
    const separator = line.indexOf("=");
    assert.notEqual(separator, -1);
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  assert.equal(journal.schema, "1");
  assert.equal(journal.project, "heyNag/codex-pet-grok-bot");
  assert.equal(journal.phase, "prepared");
  assert.equal(journal.release, "1.0.0");
  assert.equal(journal.source_ref, sourceRef);
  assert.equal(journal.codex_root, canonicalFixture);
  assert.equal(journal.dark_state, "update");
  assert.equal(journal.light_state, "none");
  assert.equal(journal.light_backup, "");
  assert.equal(journal.dark_manifest_sha256, variants.dark.manifestSha);
  assert.equal(journal.dark_spritesheet_sha256, variants.dark.spriteSha);
  assert.equal(journal.light_manifest_sha256, variants.light.manifestSha);
  assert.equal(journal.light_spritesheet_sha256, variants.light.spriteSha);

  const stagePrefix = ".codex-pet-grok-bot.stage.";
  assert.equal(path.dirname(journal.stage_root), canonicalFixture);
  assert.equal(path.basename(journal.stage_root).startsWith(stagePrefix), true);
  const transactionToken = path.basename(journal.stage_root).slice(stagePrefix.length);
  assert.match(transactionToken, new RegExp(`^\\d{8}T\\d{6}Z-${crash.pid}$`));
  assert.equal(
    journal.backup_run,
    path.join(canonicalFixture, "pet-backups", `.grok-bot-transaction-${transactionToken}`),
  );
  assert.equal(
    journal.dark_backup,
    path.join(journal.backup_run, `.previous-grok-bot-dark-${transactionToken}`),
  );

  const stageMarker = path.join(journal.stage_root, ".codex-pet-grok-bot-stage");
  const stagedBundle = path.join(journal.stage_root, `.new-grok-bot-dark-${transactionToken}`);
  assert.deepEqual((await readdir(journal.stage_root)).sort(), [
    ".codex-pet-grok-bot-stage",
    `.new-grok-bot-dark-${transactionToken}`,
  ]);
  assert.equal(
    await readFile(stageMarker, "utf8"),
    `schema=1\nproject=heyNag/codex-pet-grok-bot\npath=${journal.stage_root}\n`,
  );
  assert.deepEqual(await readFile(path.join(stagedBundle, "pet.json")), await readFile(sourcePath("dark", "pet.json")));
  assert.deepEqual(await readFile(path.join(stagedBundle, "spritesheet.webp")), await readFile(sourcePath("dark", "spritesheet.webp")));
  assert.equal(await readFile(path.join(stagedBundle, receiptName), "utf8"), expectedReceipt("dark"));

  const backupMarker = path.join(journal.backup_run, ".codex-pet-grok-bot-backup");
  assert.deepEqual((await readdir(journal.backup_run)).sort(), [
    ".codex-pet-grok-bot-backup",
    path.basename(journal.dark_backup),
  ].sort());
  assert.equal(
    await readFile(backupMarker, "utf8"),
    `schema=1\nproject=heyNag/codex-pet-grok-bot\npath=${journal.backup_run}\n`,
  );
  assert.deepEqual(await readFile(path.join(journal.dark_backup, "pet.json")), stale.manifest);
  assert.deepEqual(await readFile(path.join(journal.dark_backup, "spritesheet.webp")), stale.sprite);
  assert.deepEqual(await readFile(path.join(journal.dark_backup, receiptName)), stale.receipt);

  const recovered = await runInstaller(fixture, ["dark"]);
  const recoveryNotice = recovered.stdout.indexOf("Recovered an interrupted Grok Bot installation safely.");
  const updateNotice = recovered.stdout.indexOf("Updated Grok Bot Dark");
  assert.equal(recovered.stderr, "");
  assert.notEqual(recoveryNotice, -1);
  assert.equal(updateNotice > recoveryNotice, true);
  await assertBundleMatches(fixture, "dark");
  assert.notDeepEqual(await readFile(path.join(oldTarget, "pet.json")), stale.manifest);
  assert.deepEqual(await readdir(path.join(fixture, "pets")), [variants.dark.id]);
  assert.equal(await pathExists(lock), false);
  assert.equal(await pathExists(journal.stage_root), false);
  assert.equal(await pathExists(journal.backup_run), false);
  assert.equal(await pathExists(path.join(fixture, "pet-backups")), false);
  await assertNoTransientArtifacts(fixture);
});

test("a SIGKILL after publishing the committed journal preserves the verified new pet", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-committed-sigkill-");
  const canonicalFixture = await realpath(fixture);
  const stubDirectory = await makeFixture(context, "grok-installer-committed-sync-stub-");
  const stale = await writeOwnedStaleBundle(fixture, "dark");
  const marker = path.join(stubDirectory, "killed-after-committed-sync");
  const journalPath = path.join(
    canonicalFixture,
    ".codex-pet-grok-bot.lock",
    "transaction-journal",
  );
  const stub = path.join(stubDirectory, "sync");
  await writeFile(stub, [
    "#!/bin/sh",
    "committed=0",
    "if [ -f \"$GROK_BOT_TEST_COMMITTED_JOURNAL\" ]; then",
    "  while IFS= read -r line; do",
    "    [ \"$line\" = \"phase=committed\" ] && committed=1",
    "  done < \"$GROK_BOT_TEST_COMMITTED_JOURNAL\"",
    "fi",
    "if [ \"$committed\" = 1 ] && [ ! -e \"$GROK_BOT_TEST_COMMITTED_MARKER\" ]; then",
    "  \"$GROK_BOT_TEST_REAL_SYNC\" \"$@\" || exit $?",
    "  : > \"$GROK_BOT_TEST_COMMITTED_MARKER\"",
    "  kill -KILL \"$PPID\"",
    "  exit 0",
    "fi",
    "exec \"$GROK_BOT_TEST_REAL_SYNC\" \"$@\"",
    "",
  ].join("\n"));
  await chmod(stub, 0o700);

  const crash = await new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      CODEX_HOME: fixture,
      GROK_BOT_INSTALL_SOURCE_BASE: sourceBase,
      GROK_BOT_TEST_COMMITTED_JOURNAL: journalPath,
      GROK_BOT_TEST_COMMITTED_MARKER: marker,
      GROK_BOT_TEST_REAL_SYNC: realSync,
      PATH: `${stubDirectory}${path.delimiter}${process.env.PATH}`,
    };
    const child = spawn("/bin/sh", [installer, "dark"], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code, pid: child.pid, signal, stderr, stdout });
    });
  });

  assert.equal(crash.code, null);
  assert.equal(crash.signal, "SIGKILL");
  assert.equal(await pathExists(marker), true);
  assert.throws(() => process.kill(crash.pid, 0), { code: "ESRCH" });

  const activeTarget = targetPath(canonicalFixture, "dark");
  await assertBundleMatches(fixture, "dark");
  assert.notDeepEqual(await readFile(path.join(activeTarget, "pet.json")), stale.manifest);
  assert.deepEqual(await readdir(path.join(fixture, "pets")), [variants.dark.id]);

  const lock = path.dirname(journalPath);
  const ownerPath = path.join(lock, "owner");
  assert.deepEqual((await readdir(lock)).sort(), ["owner", "transaction-journal"]);
  assert.equal(
    await readFile(ownerPath, "utf8"),
    `project=heyNag/codex-pet-grok-bot\npid=${crash.pid}\n`,
  );

  const journalText = await readFile(journalPath, "utf8");
  const journalLines = journalText.trimEnd().split("\n");
  const journalKeys = journalLines.map((line) => line.slice(0, line.indexOf("=")));
  assert.deepEqual(journalKeys, transactionJournalKeys);
  assert.equal(new Set(journalKeys).size, 16);
  const journal = Object.fromEntries(journalLines.map((line) => {
    const separator = line.indexOf("=");
    assert.notEqual(separator, -1);
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  assert.equal(journal.schema, "1");
  assert.equal(journal.project, "heyNag/codex-pet-grok-bot");
  assert.equal(journal.phase, "committed");
  assert.equal(journal.release, "1.0.0");
  assert.equal(journal.source_ref, sourceRef);
  assert.equal(journal.codex_root, canonicalFixture);
  assert.equal(journal.dark_state, "update");
  assert.equal(journal.light_state, "none");
  assert.equal(journal.light_backup, "");
  assert.equal(journal.dark_manifest_sha256, variants.dark.manifestSha);
  assert.equal(journal.dark_spritesheet_sha256, variants.dark.spriteSha);
  assert.equal(journal.light_manifest_sha256, variants.light.manifestSha);
  assert.equal(journal.light_spritesheet_sha256, variants.light.spriteSha);

  const stagePrefix = ".codex-pet-grok-bot.stage.";
  assert.equal(path.dirname(journal.stage_root), canonicalFixture);
  assert.equal(path.basename(journal.stage_root).startsWith(stagePrefix), true);
  const transactionToken = path.basename(journal.stage_root).slice(stagePrefix.length);
  assert.match(transactionToken, new RegExp(`^\\d{8}T\\d{6}Z-${crash.pid}$`));
  assert.equal(
    journal.backup_run,
    path.join(canonicalFixture, "pet-backups", `.grok-bot-transaction-${transactionToken}`),
  );
  assert.equal(
    journal.dark_backup,
    path.join(journal.backup_run, `.previous-grok-bot-dark-${transactionToken}`),
  );

  const stageMarker = path.join(journal.stage_root, ".codex-pet-grok-bot-stage");
  assert.deepEqual(await readdir(journal.stage_root), [".codex-pet-grok-bot-stage"]);
  assert.equal(
    await readFile(stageMarker, "utf8"),
    `schema=1\nproject=heyNag/codex-pet-grok-bot\npath=${journal.stage_root}\n`,
  );

  const backupMarker = path.join(journal.backup_run, ".codex-pet-grok-bot-backup");
  assert.deepEqual((await readdir(journal.backup_run)).sort(), [
    ".codex-pet-grok-bot-backup",
    path.basename(journal.dark_backup),
  ].sort());
  assert.equal(
    await readFile(backupMarker, "utf8"),
    `schema=1\nproject=heyNag/codex-pet-grok-bot\npath=${journal.backup_run}\n`,
  );
  assert.deepEqual(await readFile(path.join(journal.dark_backup, "pet.json")), stale.manifest);
  assert.deepEqual(await readFile(path.join(journal.dark_backup, "spritesheet.webp")), stale.sprite);
  assert.deepEqual(await readFile(path.join(journal.dark_backup, receiptName)), stale.receipt);

  const recovered = await runInstaller(fixture, ["dark"]);
  const recoveryNotice = recovered.stdout.indexOf("Recovered an interrupted Grok Bot installation safely.");
  const currentNotice = recovered.stdout.indexOf("Grok Bot Dark is already up to date");
  assert.equal(recovered.stderr, "");
  assert.notEqual(recoveryNotice, -1);
  assert.equal(currentNotice > recoveryNotice, true);
  await assertBundleMatches(fixture, "dark");
  assert.notDeepEqual(await readFile(path.join(activeTarget, "pet.json")), stale.manifest);
  assert.deepEqual(await readdir(path.join(fixture, "pets")), [variants.dark.id]);
  assert.equal(await pathExists(lock), false);
  assert.equal(await pathExists(journal.stage_root), false);
  assert.equal(await pathExists(journal.backup_run), false);
  assert.equal(await pathExists(path.join(fixture, "pet-backups")), false);
  await assertNoTransientArtifacts(fixture);
});

test("a SIGKILL before publishing the stage ownership marker auto-recovers and installs", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-stage-marker-sigkill-");
  const canonicalFixture = await realpath(fixture);
  const stubDirectory = await makeFixture(context, "grok-installer-stage-marker-stub-");
  const marker = path.join(stubDirectory, "killed-before-stage-marker-rename");
  const stub = path.join(stubDirectory, "mv");
  await writeFile(stub, [
    "#!/bin/sh",
    "case \"$1\" in",
    "  \"$GROK_BOT_TEST_CODEX_ROOT\"/.codex-pet-grok-bot.stage.*/.codex-pet-grok-bot-stage.pending-*)",
    "    case \"$2\" in",
    "      \"$GROK_BOT_TEST_CODEX_ROOT\"/.codex-pet-grok-bot.stage.*/.codex-pet-grok-bot-stage)",
    "        if [ ! -e \"$GROK_BOT_TEST_KILL_MARKER\" ]; then",
    "          : > \"$GROK_BOT_TEST_KILL_MARKER\"",
    "          kill -KILL \"$PPID\"",
    "          exit 0",
    "        fi",
    "        ;;",
    "    esac",
    "    ;;",
    "esac",
    "exec \"$GROK_BOT_TEST_REAL_MV\" \"$@\"",
    "",
  ].join("\n"));
  await chmod(stub, 0o700);

  const crash = await runInstallerProcess(fixture, ["dark"], {
    pathPrefix: stubDirectory,
    env: {
      GROK_BOT_TEST_CODEX_ROOT: canonicalFixture,
      GROK_BOT_TEST_KILL_MARKER: marker,
      GROK_BOT_TEST_REAL_MV: realMv,
    },
  });

  assert.equal(crash.code, null);
  assert.equal(crash.signal, "SIGKILL");
  assert.equal(await pathExists(marker), true);
  assert.throws(() => process.kill(crash.pid, 0), { code: "ESRCH" });
  assert.equal(await pathExists(targetPath(fixture, "dark")), false);

  const lock = path.join(canonicalFixture, ".codex-pet-grok-bot.lock");
  const journalPath = path.join(lock, "transaction-journal");
  const journal = await readStrictTransactionJournal(journalPath);
  assert.equal(journal.phase, "prepared");
  assert.equal(journal.dark_state, "install");
  assert.equal(journal.backup_run, "");
  assert.equal(journal.dark_backup, "");
  const transactionToken = path.basename(journal.stage_root)
    .slice(".codex-pet-grok-bot.stage.".length);
  const pendingMarker = path.join(
    journal.stage_root,
    `.codex-pet-grok-bot-stage.pending-${transactionToken}`,
  );
  assert.deepEqual(await readdir(journal.stage_root), [path.basename(pendingMarker)]);
  assert.equal(await readFile(pendingMarker, "utf8"), expectedOwnedMarker(journal.stage_root));
  assert.equal(
    await pathExists(path.join(journal.stage_root, ".codex-pet-grok-bot-stage")),
    false,
  );

  const recovered = await runInstaller(fixture, ["dark"]);
  const recoveryNotice = recovered.stdout.indexOf("Recovered an interrupted Grok Bot installation safely.");
  const installNotice = recovered.stdout.indexOf("Installed Grok Bot Dark");
  assert.equal(recovered.stderr, "");
  assert.notEqual(recoveryNotice, -1);
  assert.equal(installNotice > recoveryNotice, true);
  await assertBundleMatches(fixture, "dark");
  assert.deepEqual(await readdir(path.join(fixture, "pets")), [variants.dark.id]);
  assert.equal(await pathExists(lock), false);
  assert.equal(await pathExists(journal.stage_root), false);
  assert.equal(await pathExists(path.join(fixture, "pet-backups")), false);
  await assertNoTransientArtifacts(fixture);
});

test("a SIGKILL before publishing the backup ownership marker auto-recovers and updates", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-backup-marker-sigkill-");
  const canonicalFixture = await realpath(fixture);
  const stubDirectory = await makeFixture(context, "grok-installer-backup-marker-stub-");
  const stale = await writeOwnedStaleBundle(fixture, "dark");
  const marker = path.join(stubDirectory, "killed-before-backup-marker-rename");
  const stub = path.join(stubDirectory, "mv");
  await writeFile(stub, [
    "#!/bin/sh",
    "case \"$1\" in",
    "  \"$GROK_BOT_TEST_BACKUP_ROOT\"/.grok-bot-transaction-*/.codex-pet-grok-bot-backup.pending-*)",
    "    case \"$2\" in",
    "      \"$GROK_BOT_TEST_BACKUP_ROOT\"/.grok-bot-transaction-*/.codex-pet-grok-bot-backup)",
    "        if [ ! -e \"$GROK_BOT_TEST_KILL_MARKER\" ]; then",
    "          : > \"$GROK_BOT_TEST_KILL_MARKER\"",
    "          kill -KILL \"$PPID\"",
    "          exit 0",
    "        fi",
    "        ;;",
    "    esac",
    "    ;;",
    "esac",
    "exec \"$GROK_BOT_TEST_REAL_MV\" \"$@\"",
    "",
  ].join("\n"));
  await chmod(stub, 0o700);

  const crash = await runInstallerProcess(fixture, ["dark"], {
    pathPrefix: stubDirectory,
    env: {
      GROK_BOT_TEST_BACKUP_ROOT: path.join(canonicalFixture, "pet-backups"),
      GROK_BOT_TEST_KILL_MARKER: marker,
      GROK_BOT_TEST_REAL_MV: realMv,
    },
  });

  assert.equal(crash.code, null);
  assert.equal(crash.signal, "SIGKILL");
  assert.equal(await pathExists(marker), true);
  assert.throws(() => process.kill(crash.pid, 0), { code: "ESRCH" });
  const activeTarget = targetPath(fixture, "dark");
  assert.deepEqual(await readFile(path.join(activeTarget, "pet.json")), stale.manifest);
  assert.deepEqual(await readFile(path.join(activeTarget, "spritesheet.webp")), stale.sprite);
  assert.deepEqual(await readFile(path.join(activeTarget, receiptName)), stale.receipt);

  const lock = path.join(canonicalFixture, ".codex-pet-grok-bot.lock");
  const journal = await readStrictTransactionJournal(path.join(lock, "transaction-journal"));
  assert.equal(journal.phase, "prepared");
  assert.equal(journal.dark_state, "update");
  assert.deepEqual(await readdir(journal.stage_root), [".codex-pet-grok-bot-stage"]);
  assert.equal(
    await readFile(path.join(journal.stage_root, ".codex-pet-grok-bot-stage"), "utf8"),
    expectedOwnedMarker(journal.stage_root),
  );
  const transactionToken = path.basename(journal.backup_run)
    .slice(".grok-bot-transaction-".length);
  const pendingMarker = path.join(
    journal.backup_run,
    `.codex-pet-grok-bot-backup.pending-${transactionToken}`,
  );
  assert.deepEqual(await readdir(journal.backup_run), [path.basename(pendingMarker)]);
  assert.equal(await readFile(pendingMarker, "utf8"), expectedOwnedMarker(journal.backup_run));
  assert.equal(
    await pathExists(path.join(journal.backup_run, ".codex-pet-grok-bot-backup")),
    false,
  );
  assert.equal(await pathExists(journal.dark_backup), false);

  const recovered = await runInstaller(fixture, ["dark"]);
  const recoveryNotice = recovered.stdout.indexOf("Recovered an interrupted Grok Bot installation safely.");
  const updateNotice = recovered.stdout.indexOf("Updated Grok Bot Dark");
  assert.equal(recovered.stderr, "");
  assert.notEqual(recoveryNotice, -1);
  assert.equal(updateNotice > recoveryNotice, true);
  await assertBundleMatches(fixture, "dark");
  assert.deepEqual(await readdir(path.join(fixture, "pets")), [variants.dark.id]);
  assert.equal(await pathExists(lock), false);
  assert.equal(await pathExists(journal.stage_root), false);
  assert.equal(await pathExists(journal.backup_run), false);
  assert.equal(await pathExists(path.join(fixture, "pet-backups")), false);
  await assertNoTransientArtifacts(fixture);
});

test("an old-target backup destination race restores the old pet and preserves the sentinel transaction", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-backup-race-");
  const canonicalFixture = await realpath(fixture);
  const stubDirectory = await makeFixture(context, "grok-installer-backup-race-stub-");
  const stale = await writeOwnedStaleBundle(fixture, "dark");
  const raceMarker = path.join(stubDirectory, "created-backup-destination");
  const stub = path.join(stubDirectory, "mv");
  await writeFile(stub, [
    "#!/bin/sh",
    "if [ \"$#\" -eq 2 ] && [ \"$1\" = \"$GROK_BOT_TEST_OLD_TARGET\" ] && [ ! -e \"$GROK_BOT_TEST_RACE_MARKER\" ]; then",
    "  case \"$2\" in",
    "    \"$GROK_BOT_TEST_BACKUP_ROOT\"/.grok-bot-transaction-*/.previous-grok-bot-dark-*)",
    "      mkdir -p \"$2\"",
    "      printf '%s\\n' 'preserve this sentinel' > \"$2/sentinel\"",
    "      : > \"$GROK_BOT_TEST_RACE_MARKER\"",
    "      ;;",
    "  esac",
    "fi",
    "exec \"$GROK_BOT_TEST_REAL_MV\" \"$@\"",
    "",
  ].join("\n"));
  await chmod(stub, 0o700);

  const firstError = await expectFailure(runInstaller(fixture, ["dark"], {
    pathPrefix: stubDirectory,
    env: {
      GROK_BOT_TEST_BACKUP_ROOT: path.join(canonicalFixture, "pet-backups"),
      GROK_BOT_TEST_OLD_TARGET: targetPath(canonicalFixture, "dark"),
      GROK_BOT_TEST_RACE_MARKER: raceMarker,
      GROK_BOT_TEST_REAL_MV: realMv,
    },
  }));

  assert.equal(await pathExists(raceMarker), true);
  assert.match(firstError.stderr, /could not preserve the previous Grok Bot Dark installation/);
  assert.match(firstError.stderr, /automatic rollback was incomplete/);
  assert.match(firstError.stderr, /preserved transaction state for automatic recovery/);
  const activeTarget = targetPath(fixture, "dark");
  assert.deepEqual(await readFile(path.join(activeTarget, "pet.json")), stale.manifest);
  assert.deepEqual(await readFile(path.join(activeTarget, "spritesheet.webp")), stale.sprite);
  assert.deepEqual(await readFile(path.join(activeTarget, receiptName)), stale.receipt);

  const lock = path.join(canonicalFixture, ".codex-pet-grok-bot.lock");
  const journalPath = path.join(lock, "transaction-journal");
  const journal = await readStrictTransactionJournal(journalPath);
  assert.equal(journal.phase, "prepared");
  assert.equal(journal.dark_state, "update");
  assert.equal(
    await readFile(path.join(journal.dark_backup, "sentinel"), "utf8"),
    "preserve this sentinel\n",
  );
  assert.deepEqual(await readdir(journal.dark_backup), ["sentinel"]);
  assert.equal(
    await readFile(path.join(journal.backup_run, ".codex-pet-grok-bot-backup"), "utf8"),
    expectedOwnedMarker(journal.backup_run),
  );
  assert.equal(
    await readFile(path.join(journal.stage_root, ".codex-pet-grok-bot-stage"), "utf8"),
    expectedOwnedMarker(journal.stage_root),
  );

  const secondError = await expectFailure(runInstaller(fixture, ["dark"]));
  assert.match(secondError.stderr, /lock needs inspection/);
  assert.deepEqual(await readFile(path.join(activeTarget, "pet.json")), stale.manifest);
  assert.deepEqual(await readFile(path.join(activeTarget, "spritesheet.webp")), stale.sprite);
  assert.deepEqual(await readFile(path.join(activeTarget, receiptName)), stale.receipt);
  assert.equal(
    await readFile(path.join(journal.dark_backup, "sentinel"), "utf8"),
    "preserve this sentinel\n",
  );
  assert.deepEqual(await readdir(journal.dark_backup), ["sentinel"]);
  assert.deepEqual((await readdir(lock)).sort(), ["owner", "transaction-journal"]);
  assert.equal(await pathExists(journal.stage_root), true);
  assert.equal(await pathExists(journal.backup_run), true);
});

test("TERM during committed-journal durability preserves the new pet for recovery", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-committed-term-");
  const canonicalFixture = await realpath(fixture);
  const stubDirectory = await makeFixture(context, "grok-installer-committed-term-stub-");
  const stale = await writeOwnedStaleBundle(fixture, "dark");
  const marker = path.join(stubDirectory, "termed-during-committed-sync");
  const journalPath = path.join(
    canonicalFixture,
    ".codex-pet-grok-bot.lock",
    "transaction-journal",
  );
  const stub = path.join(stubDirectory, "sync");
  await writeFile(stub, [
    "#!/bin/sh",
    "committed=0",
    "if [ -f \"$GROK_BOT_TEST_COMMITTED_JOURNAL\" ]; then",
    "  while IFS= read -r line; do",
    "    [ \"$line\" = \"phase=committed\" ] && committed=1",
    "  done < \"$GROK_BOT_TEST_COMMITTED_JOURNAL\"",
    "fi",
    "if [ \"$committed\" = 1 ] && [ ! -e \"$GROK_BOT_TEST_COMMITTED_MARKER\" ]; then",
    "  : > \"$GROK_BOT_TEST_COMMITTED_MARKER\"",
    "  kill -TERM \"$PPID\"",
    "  exit 0",
    "fi",
    "exec \"$GROK_BOT_TEST_REAL_SYNC\" \"$@\"",
    "",
  ].join("\n"));
  await chmod(stub, 0o700);

  const error = await expectFailure(runInstaller(fixture, ["dark"], {
    pathPrefix: stubDirectory,
    env: {
      GROK_BOT_TEST_COMMITTED_JOURNAL: journalPath,
      GROK_BOT_TEST_COMMITTED_MARKER: marker,
      GROK_BOT_TEST_REAL_SYNC: realSync,
    },
  }));

  assert.equal(await pathExists(marker), true);
  assert.match(error.stderr, /preserved transaction state for automatic recovery/);
  const activeTarget = targetPath(fixture, "dark");
  await assertBundleMatches(fixture, "dark");
  assert.notDeepEqual(await readFile(path.join(activeTarget, "pet.json")), stale.manifest);
  const lock = path.join(canonicalFixture, ".codex-pet-grok-bot.lock");
  const journal = await readStrictTransactionJournal(journalPath);
  assert.equal(journal.phase, "committed");
  assert.equal(journal.dark_state, "update");
  assert.deepEqual(await readFile(path.join(journal.dark_backup, "pet.json")), stale.manifest);
  assert.deepEqual(await readFile(path.join(journal.dark_backup, "spritesheet.webp")), stale.sprite);
  assert.deepEqual(await readFile(path.join(journal.dark_backup, receiptName)), stale.receipt);
  assert.deepEqual(await readdir(journal.stage_root), [".codex-pet-grok-bot-stage"]);

  const recovered = await runInstaller(fixture, ["dark"]);
  const recoveryNotice = recovered.stdout.indexOf("Recovered an interrupted Grok Bot installation safely.");
  const currentNotice = recovered.stdout.indexOf("Grok Bot Dark is already up to date");
  assert.equal(recovered.stderr, "");
  assert.notEqual(recoveryNotice, -1);
  assert.equal(currentNotice > recoveryNotice, true);
  await assertBundleMatches(fixture, "dark");
  assert.notDeepEqual(await readFile(path.join(activeTarget, "pet.json")), stale.manifest);
  assert.deepEqual(await readdir(path.join(fixture, "pets")), [variants.dark.id]);
  assert.equal(await pathExists(lock), false);
  assert.equal(await pathExists(journal.stage_root), false);
  assert.equal(await pathExists(journal.backup_run), false);
  assert.equal(await pathExists(path.join(fixture, "pet-backups")), false);
  await assertNoTransientArtifacts(fixture);
});

test("a recovery park destination race restores the new pet and preserves the sentinel", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-recovery-park-race-");
  const canonicalFixture = await realpath(fixture);
  const crashStubDirectory = await makeFixture(context, "grok-installer-prepared-active-stub-");
  const preparedMarker = path.join(crashStubDirectory, "killed-with-prepared-active-pet");
  const journalPath = path.join(
    canonicalFixture,
    ".codex-pet-grok-bot.lock",
    "transaction-journal",
  );
  const activeTarget = targetPath(canonicalFixture, "dark");
  const syncStub = path.join(crashStubDirectory, "sync");
  await writeFile(syncStub, [
    "#!/bin/sh",
    "prepared=0",
    "if [ -f \"$GROK_BOT_TEST_PREPARED_JOURNAL\" ]; then",
    "  while IFS= read -r line; do",
    "    [ \"$line\" = \"phase=prepared\" ] && prepared=1",
    "  done < \"$GROK_BOT_TEST_PREPARED_JOURNAL\"",
    "fi",
    "if [ \"$prepared\" = 1 ] && [ -d \"$GROK_BOT_TEST_ACTIVE_TARGET\" ] && [ ! -e \"$GROK_BOT_TEST_PREPARED_MARKER\" ]; then",
    "  \"$GROK_BOT_TEST_REAL_SYNC\" \"$@\" || exit $?",
    "  : > \"$GROK_BOT_TEST_PREPARED_MARKER\"",
    "  kill -KILL \"$PPID\"",
    "  exit 0",
    "fi",
    "exec \"$GROK_BOT_TEST_REAL_SYNC\" \"$@\"",
    "",
  ].join("\n"));
  await chmod(syncStub, 0o700);

  const crash = await runInstallerProcess(fixture, ["dark"], {
    pathPrefix: crashStubDirectory,
    env: {
      GROK_BOT_TEST_ACTIVE_TARGET: activeTarget,
      GROK_BOT_TEST_PREPARED_JOURNAL: journalPath,
      GROK_BOT_TEST_PREPARED_MARKER: preparedMarker,
      GROK_BOT_TEST_REAL_SYNC: realSync,
    },
  });

  assert.equal(crash.code, null);
  assert.equal(crash.signal, "SIGKILL");
  assert.equal(await pathExists(preparedMarker), true);
  assert.throws(() => process.kill(crash.pid, 0), { code: "ESRCH" });
  await assertBundleMatches(fixture, "dark");
  const journal = await readStrictTransactionJournal(journalPath);
  assert.equal(journal.phase, "prepared");
  assert.equal(journal.dark_state, "install");
  assert.equal(journal.backup_run, "");
  assert.deepEqual(await readdir(journal.stage_root), [".codex-pet-grok-bot-stage"]);

  const raceStubDirectory = await makeFixture(context, "grok-installer-recovery-park-stub-");
  const raceMarker = path.join(raceStubDirectory, "created-recovery-park-destination");
  const recoveryPark = path.join(
    journal.stage_root,
    `.recovered-grok-bot-dark-${crash.pid}`,
  );
  const mvStub = path.join(raceStubDirectory, "mv");
  await writeFile(mvStub, [
    "#!/bin/sh",
    "if [ \"$#\" -eq 2 ] && [ \"$1\" = \"$GROK_BOT_TEST_ACTIVE_TARGET\" ] && [ \"$2\" = \"$GROK_BOT_TEST_RECOVERY_PARK\" ] && [ ! -e \"$GROK_BOT_TEST_RACE_MARKER\" ]; then",
    "  mkdir -p \"$2\"",
    "  printf '%s\\n' 'preserve recovery sentinel' > \"$2/sentinel\"",
    "  : > \"$GROK_BOT_TEST_RACE_MARKER\"",
    "fi",
    "exec \"$GROK_BOT_TEST_REAL_MV\" \"$@\"",
    "",
  ].join("\n"));
  await chmod(mvStub, 0o700);

  const recoveryError = await expectFailure(runInstaller(fixture, ["dark"], {
    pathPrefix: raceStubDirectory,
    env: {
      GROK_BOT_TEST_ACTIVE_TARGET: activeTarget,
      GROK_BOT_TEST_RACE_MARKER: raceMarker,
      GROK_BOT_TEST_REAL_MV: realMv,
      GROK_BOT_TEST_RECOVERY_PARK: recoveryPark,
    },
  }));

  assert.match(recoveryError.stderr, /lock needs inspection/);
  assert.equal(await pathExists(raceMarker), true);
  await assertBundleMatches(fixture, "dark");
  assert.equal(
    await readFile(path.join(recoveryPark, "sentinel"), "utf8"),
    "preserve recovery sentinel\n",
  );
  assert.deepEqual(await readdir(recoveryPark), ["sentinel"]);
  assert.equal(
    await readFile(path.join(journal.stage_root, ".codex-pet-grok-bot-stage"), "utf8"),
    expectedOwnedMarker(journal.stage_root),
  );
  assert.deepEqual(
    (await readdir(path.dirname(journalPath))).sort(),
    ["owner", "transaction-journal"],
  );
  assert.equal(await pathExists(journal.stage_root), true);
  assert.equal(await pathExists(path.join(fixture, "pet-backups")), false);
  assert.deepEqual(await readdir(path.join(fixture, "pets")), [variants.dark.id]);
});

test("a third run recovers when recovery itself dies before publishing the stable stage marker", async (context) => {
  const fixture = await makeFixture(context, "grok-installer-nested-recovery-");
  const canonicalFixture = await realpath(fixture);
  const lock = path.join(canonicalFixture, ".codex-pet-grok-bot.lock");
  const journalPath = path.join(lock, "transaction-journal");

  const firstStubDirectory = await makeFixture(context, "grok-installer-first-crash-stub-");
  const firstMarker = path.join(firstStubDirectory, "first-process-killed-after-prepared-journal");
  const syncStub = path.join(firstStubDirectory, "sync");
  await writeFile(syncStub, [
    "#!/bin/sh",
    "prepared=0",
    "if [ -f \"$GROK_BOT_TEST_PREPARED_JOURNAL\" ]; then",
    "  while IFS= read -r line; do",
    "    [ \"$line\" = \"phase=prepared\" ] && prepared=1",
    "  done < \"$GROK_BOT_TEST_PREPARED_JOURNAL\"",
    "fi",
    "if [ \"$prepared\" = 1 ] && [ ! -e \"$GROK_BOT_TEST_FIRST_MARKER\" ]; then",
    "  \"$GROK_BOT_TEST_REAL_SYNC\" \"$@\" || exit $?",
    "  : > \"$GROK_BOT_TEST_FIRST_MARKER\"",
    "  kill -KILL \"$PPID\"",
    "  exit 0",
    "fi",
    "exec \"$GROK_BOT_TEST_REAL_SYNC\" \"$@\"",
    "",
  ].join("\n"));
  await chmod(syncStub, 0o700);

  const firstCrash = await runInstallerProcess(fixture, ["dark"], {
    pathPrefix: firstStubDirectory,
    env: {
      GROK_BOT_TEST_FIRST_MARKER: firstMarker,
      GROK_BOT_TEST_PREPARED_JOURNAL: journalPath,
      GROK_BOT_TEST_REAL_SYNC: realSync,
    },
  });

  assert.equal(firstCrash.code, null);
  assert.equal(firstCrash.signal, "SIGKILL");
  assert.equal(await pathExists(firstMarker), true);
  assert.throws(() => process.kill(firstCrash.pid, 0), { code: "ESRCH" });
  const journal = await readStrictTransactionJournal(journalPath);
  assert.equal(journal.phase, "prepared");
  assert.equal(journal.dark_state, "install");
  assert.equal(journal.backup_run, "");
  assert.equal(await pathExists(journal.stage_root), false);
  assert.equal(await pathExists(targetPath(fixture, "dark")), false);
  assert.deepEqual((await readdir(lock)).sort(), ["owner", "transaction-journal"]);
  assert.equal(
    await readFile(path.join(lock, "owner"), "utf8"),
    `project=heyNag/codex-pet-grok-bot\npid=${firstCrash.pid}\n`,
  );

  const transactionToken = path.basename(journal.stage_root)
    .slice(".codex-pet-grok-bot.stage.".length);
  const stablePendingMarker = path.join(
    journal.stage_root,
    `.codex-pet-grok-bot-stage.pending-${transactionToken}`,
  );
  const finalStageMarker = path.join(journal.stage_root, ".codex-pet-grok-bot-stage");
  const secondStubDirectory = await makeFixture(context, "grok-installer-second-crash-stub-");
  const secondMarker = path.join(secondStubDirectory, "recovery-killed-before-marker-rename");
  const mvStub = path.join(secondStubDirectory, "mv");
  await writeFile(mvStub, [
    "#!/bin/sh",
    "if [ \"$#\" -eq 2 ] && [ \"$1\" = \"$GROK_BOT_TEST_STABLE_PENDING\" ] && [ \"$2\" = \"$GROK_BOT_TEST_FINAL_MARKER\" ] && [ ! -e \"$GROK_BOT_TEST_SECOND_MARKER\" ]; then",
    "  : > \"$GROK_BOT_TEST_SECOND_MARKER\"",
    "  kill -KILL \"$PPID\"",
    "  exit 0",
    "fi",
    "exec \"$GROK_BOT_TEST_REAL_MV\" \"$@\"",
    "",
  ].join("\n"));
  await chmod(mvStub, 0o700);

  const secondCrash = await runInstallerProcess(fixture, ["dark"], {
    pathPrefix: secondStubDirectory,
    env: {
      GROK_BOT_TEST_FINAL_MARKER: finalStageMarker,
      GROK_BOT_TEST_REAL_MV: realMv,
      GROK_BOT_TEST_SECOND_MARKER: secondMarker,
      GROK_BOT_TEST_STABLE_PENDING: stablePendingMarker,
    },
  });

  assert.equal(secondCrash.code, null);
  assert.equal(secondCrash.signal, "SIGKILL");
  assert.equal(await pathExists(secondMarker), true);
  assert.throws(() => process.kill(secondCrash.pid, 0), { code: "ESRCH" });
  assert.deepEqual(await readdir(journal.stage_root), [path.basename(stablePendingMarker)]);
  assert.equal(
    await readFile(stablePendingMarker, "utf8"),
    expectedOwnedMarker(journal.stage_root),
  );
  assert.equal(await pathExists(finalStageMarker), false);
  assert.equal(await pathExists(targetPath(fixture, "dark")), false);
  assert.deepEqual((await readdir(lock)).sort(), [
    "owner",
    "recovery-claim",
    "transaction-journal",
  ]);
  assert.equal(
    await readFile(path.join(lock, "owner"), "utf8"),
    `project=heyNag/codex-pet-grok-bot\npid=${firstCrash.pid}\n`,
  );
  assert.equal(
    await readFile(path.join(lock, "recovery-claim", "owner"), "utf8"),
    `project=heyNag/codex-pet-grok-bot\npid=${secondCrash.pid}\n`,
  );
  assert.deepEqual(await readStrictTransactionJournal(journalPath), journal);

  const recovered = await runInstaller(fixture, ["dark"]);
  const recoveryNotice = recovered.stdout.indexOf("Recovered an interrupted Grok Bot installation safely.");
  const installNotice = recovered.stdout.indexOf("Installed Grok Bot Dark");
  assert.equal(recovered.stderr, "");
  assert.notEqual(recoveryNotice, -1);
  assert.equal(installNotice > recoveryNotice, true);
  await assertBundleMatches(fixture, "dark");
  assert.deepEqual(await readdir(path.join(fixture, "pets")), [variants.dark.id]);
  assert.equal(await pathExists(lock), false);
  assert.equal(await pathExists(journal.stage_root), false);
  assert.equal(await pathExists(path.join(fixture, "pet-backups")), false);
  await assertNoTransientArtifacts(fixture);
});
