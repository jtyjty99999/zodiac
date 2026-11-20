import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGit } from "./mirror";

const SNAPSHOT_TIMEOUT_MS = 180_000;
const CLEANUP_TIMEOUT_MS = 30_000;

/** Creates an isolated directory that holds temporary working trees. */
export function createSnapshotRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zodiac-explore-"));
}

/**
 * Materializes `rev` from a bare mirror as a detached worktree so tools that
 * need real files (e.g. the local Claude Code CLI) can read it.
 */
export async function createSnapshot(
  mirrorDir: string,
  rev: string,
  root: string,
  name: string,
): Promise<string> {
  const target = path.join(root, name);
  await runGit(["--git-dir", mirrorDir, "worktree", "add", "--detach", target, rev], {
    timeoutMs: SNAPSHOT_TIMEOUT_MS,
    env: { GIT_NO_LAZY_FETCH: "1" },
  });
  return target;
}

/**
 * Removes a snapshot worktree. Falls back to deleting the directory and
 * pruning stale worktree metadata so a failed cleanup cannot block the next run.
 */
export async function removeSnapshot(mirrorDir: string, target: string): Promise<void> {
  try {
    await runGit(["--git-dir", mirrorDir, "worktree", "remove", "--force", target], {
      timeoutMs: CLEANUP_TIMEOUT_MS,
    });
  } catch {
    await fs.promises.rm(target, { recursive: true, force: true });
    try {
      await runGit(["--git-dir", mirrorDir, "worktree", "prune"], {
        timeoutMs: CLEANUP_TIMEOUT_MS,
      });
    } catch {
      // Best effort: a stale worktree entry only wastes a little metadata.
    }
  }
}

export async function removeSnapshotRoot(root: string): Promise<void> {
  await fs.promises.rm(root, { recursive: true, force: true });
}
