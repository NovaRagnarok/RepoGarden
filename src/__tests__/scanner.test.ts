import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { spawnSync } from "node:child_process";

import { writeFileSync } from "node:fs";

import { findRepos, scanRoots, expandPath, inspectRepoLight } from "../lib/scanner";

const initRepo = (path: string) => {
  mkdirSync(path, { recursive: true });
  spawnSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: path });
  // Give git an identity so commits don't fail.
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: path });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: path });
  spawnSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: path });
};

test("expandPath turns ~ into the home directory", () => {
  const expanded = expandPath("~/foo");
  assert.ok(expanded.endsWith(`${sep}foo`));
  assert.ok(!expanded.startsWith("~"));
});

test("findRepos discovers nested git repos under a root", () => {
  const root = mkdtempSync(join(tmpdir(), "repogarden-tui-"));
  try {
    initRepo(join(root, "alpha"));
    initRepo(join(root, "beta", "gamma"));
    mkdirSync(join(root, "not-a-repo"), { recursive: true });

    const found = findRepos(root, 4);
    assert.equal(found.length, 2);
    assert.ok(found.some((p) => p.endsWith(`${sep}alpha`)));
    assert.ok(found.some((p) => p.endsWith(`${sep}gamma`)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findRepos skips node_modules and other heavy dirs", () => {
  const root = mkdtempSync(join(tmpdir(), "repogarden-tui-"));
  try {
    initRepo(join(root, "real"));
    initRepo(join(root, "node_modules", "should-be-skipped"));

    const found = findRepos(root, 4);
    assert.equal(found.length, 1);
    assert.ok(found[0].endsWith(`${sep}real`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scanRoots returns empty repos and an error when path is missing", () => {
  const result = scanRoots(["/this/path/does/not/exist/repogarden-test"], 2);
  assert.equal(result.repos.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /does not exist/);
});

test("inspectRepoLight reports branch + clean state for a fresh repo", () => {
  const root = mkdtempSync(join(tmpdir(), "repogarden-tui-light-"));
  try {
    initRepo(join(root, "alpha"));
    const probe = inspectRepoLight(join(root, "alpha"));
    assert.ok(probe);
    assert.equal(probe!.branch, "main");
    assert.equal(probe!.isDirty, false);
    assert.ok(probe!.headSha && probe!.headSha.length >= 7);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inspectRepoLight flips isDirty when working tree has an untracked file", () => {
  const root = mkdtempSync(join(tmpdir(), "repogarden-tui-light-"));
  try {
    const repoPath = join(root, "alpha");
    initRepo(repoPath);
    writeFileSync(join(repoPath, "scratch.txt"), "hello");
    const probe = inspectRepoLight(repoPath);
    assert.ok(probe);
    assert.equal(probe!.isDirty, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inspectRepoLight returns null when path is not a git repo", () => {
  const root = mkdtempSync(join(tmpdir(), "repogarden-tui-light-"));
  try {
    mkdirSync(join(root, "not-a-repo"), { recursive: true });
    const probe = inspectRepoLight(join(root, "not-a-repo"));
    assert.equal(probe, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scanRoots inspects each repo and assigns a stable id", () => {
  const root = mkdtempSync(join(tmpdir(), "repogarden-tui-"));
  try {
    initRepo(join(root, "alpha"));
    const first = scanRoots([root], 2);
    const second = scanRoots([root], 2);
    assert.equal(first.repos.length, 1);
    assert.equal(first.repos[0].name, "alpha");
    assert.equal(first.repos[0].branch, "main");
    assert.equal(first.repos[0].id, second.repos[0].id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parseGitStatusPorcelain parses ordinary, untracked, and renamed files", async () => {
  const { parseGitStatusPorcelain } = await import("../lib/scanner");
  const parsed = parseGitStatusPorcelain(" M src/app.ts\n?? scratch.md\nR  old.ts -> new.ts\n");

  assert.equal(parsed.length, 3);
  assert.deepEqual(
    parsed.map((file) => [file.filename, file.label, file.untracked]),
    [
      ["src/app.ts", "modified", false],
      ["scratch.md", "untracked", true],
      ["new.ts", "renamed", false],
    ]
  );
  assert.equal(parsed[2].renamedFrom, "old.ts");
});

test("parseGitStatusPorcelain supports NUL-separated rename output", async () => {
  const { parseGitStatusPorcelain } = await import("../lib/scanner");
  const parsed = parseGitStatusPorcelain("R  new-name.ts\0old-name.ts\0");

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].filename, "new-name.ts");
  assert.equal(parsed[0].renamedFrom, "old-name.ts");
});

// ---------------------------------------------------------------------------
// Dirty-file preview safety: large/binary/sensitive files skip content reads
// ---------------------------------------------------------------------------

const commitFile = (cwd: string, filename: string, content: string | Buffer) => {
  writeFileSync(join(cwd, filename), content);
  spawnSync("git", ["add", filename], { cwd });
  spawnSync("git", ["commit", "-m", `add ${filename}`, "--quiet"], { cwd });
};

test("dirty-file preview marks large files as skipped instead of reading them", async () => {
  const { inspectRepo } = await import("../lib/scanner");
  const root = mkdtempSync(join(tmpdir(), "repogarden-dirty-large-"));
  try {
    const repo = join(root, "alpha");
    initRepo(repo);
    commitFile(repo, "big.txt", "ok\n");
    // Overwrite with > 256 KB to exceed DIRTY_PREVIEW_MAX_BYTES.
    writeFileSync(join(repo, "big.txt"), "x".repeat(300 * 1024));

    const scan = inspectRepo(repo);
    const change = scan.dirtyChanges?.find((c) => c.filename === "big.txt");
    assert.ok(change, "expected big.txt in dirtyChanges");
    assert.equal(change!.skipped, "too-large");
    assert.equal(change!.oldText, "");
    assert.equal(change!.newText, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dirty-file preview marks binary files as skipped", async () => {
  const { inspectRepo } = await import("../lib/scanner");
  const root = mkdtempSync(join(tmpdir(), "repogarden-dirty-binary-"));
  try {
    const repo = join(root, "alpha");
    initRepo(repo);
    commitFile(repo, "img.bin", Buffer.from("placeholder"));
    // Replace working-tree content with bytes containing a NUL.
    writeFileSync(join(repo, "img.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));

    const scan = inspectRepo(repo);
    const change = scan.dirtyChanges?.find((c) => c.filename === "img.bin");
    assert.ok(change, "expected img.bin in dirtyChanges");
    assert.equal(change!.skipped, "binary");
    assert.equal(change!.oldText, "");
    assert.equal(change!.newText, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dirty-file preview marks sensitive filenames as skipped", async () => {
  const { inspectRepo } = await import("../lib/scanner");
  const root = mkdtempSync(join(tmpdir(), "repogarden-dirty-sensitive-"));
  try {
    const repo = join(root, "alpha");
    initRepo(repo);
    commitFile(repo, ".env", "TOKEN=old\n");
    writeFileSync(join(repo, ".env"), "TOKEN=brand_new_secret_value\n");

    const scan = inspectRepo(repo);
    const change = scan.dirtyChanges?.find((c) => c.filename === ".env");
    assert.ok(change, "expected .env in dirtyChanges");
    assert.equal(change!.skipped, "sensitive");
    // Critically, the secret value must not have been loaded into oldText/newText.
    assert.equal(change!.oldText, "");
    assert.equal(change!.newText, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
