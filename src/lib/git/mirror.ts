import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isValidBranch, isValidRepoUrl, slugSchema } from "../validation/schemas";

// The data directory holds mirrors and snapshots, never build assets.
export const DATA_DIR = path.resolve(
  /* turbopackIgnore: true */ process.env.ZODIAC_DATA_DIR?.trim() ||
    path.join(process.cwd(), "data"),
);

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_BUFFER = 128 * 1024 * 1024;

export interface GitResult {
  stdout: string;
  stderr: string;
}

export function runGit(
  args: string[],
  options: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        env: {
          ...process.env,
          ...options.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: "echo",
          LC_ALL: "C",
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr?.trim() || error.message;
          reject(new Error(`git ${args.slice(0, 3).join(" ")} failed: ${detail.slice(0, 2000)}`));
          return;
        }
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      },
    );
  });
}

export function mirrorPath(slug: string): string {
  if (!slugSchema.safeParse(slug).success) {
    throw new Error(`Invalid harness slug: ${slug}`);
  }
  return path.join(DATA_DIR, "mirrors", `${slug}.git`);
}

/** Deletes the on-disk mirror and stored diffs for a removed harness. */
export function removeHarnessData(slug: string): void {
  if (!slugSchema.safeParse(slug).success) {
    throw new Error(`Invalid harness slug: ${slug}`);
  }
  fs.rmSync(mirrorPath(slug), { recursive: true, force: true });
  fs.rmSync(path.join(DATA_DIR, "diffs", slug), { recursive: true, force: true });
}

export interface MirrorInput {
  slug: string;
  repoUrl: string;
  branch: string;
  depth?: number;
  /**
   * Test/CLI-only escape hatch: allow a `file://` repository URL. Never set
   * this from HTTP request handlers.
   */
  allowLocalRepo?: boolean;
}

export interface MirrorInfo {
  dir: string;
  headSha: string;
  cloned: boolean;
}

const DEFAULT_DEPTH = 300;

export async function ensureMirror(input: MirrorInput): Promise<MirrorInfo> {
  if (input.allowLocalRepo) {
    if (!input.repoUrl.startsWith("file://")) {
      throw new Error("Local repository override only supports file:// URLs");
    }
  } else if (!isValidRepoUrl(input.repoUrl)) {
    throw new Error("Invalid repository URL");
  }
  if (!isValidBranch(input.branch)) throw new Error("Invalid branch");
  const dir = mirrorPath(input.slug);
  const depth = Math.min(Math.max(input.depth ?? DEFAULT_DEPTH, 1), 5000);
  // Restrict remote protocols so a redirect from a remote can never fall back
  // to file:// or other transports. Local test mirrors opt out explicitly.
  const gitEnv = input.allowLocalRepo ? undefined : { GIT_ALLOW_PROTOCOL: "https:ssh" };

  if (!fs.existsSync(path.join(dir, "HEAD"))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await runGit(
      [
        "clone",
        "--bare",
        "--single-branch",
        "--branch",
        input.branch,
        "--depth",
        String(depth),
        "--",
        input.repoUrl,
        dir,
      ],
      { env: gitEnv },
    );
    const headSha = await revParse(dir, input.branch);
    return { dir, headSha, cloned: true };
  }

  const remote = (
    await runGit(["--git-dir", dir, "config", "--get", "remote.origin.url"])
  ).stdout.trim();
  if (remote !== input.repoUrl) {
    await runGit(["--git-dir", dir, "remote", "set-url", "origin", input.repoUrl]);
  }

  await runGit(
    [
      "--git-dir",
      dir,
      "fetch",
      "--prune",
      "--tags",
      "--depth",
      String(depth),
      "origin",
      `+refs/heads/${input.branch}:refs/heads/${input.branch}`,
    ],
    { env: gitEnv },
  );

  const headSha = await revParse(dir, input.branch);
  return { dir, headSha, cloned: false };
}

export async function revParse(dir: string, branch: string): Promise<string> {
  const ref = validRef(branch);
  const result = await runGit(["--git-dir", dir, "rev-parse", "--verify", `${ref}^{commit}`]);
  const sha = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("Unable to resolve branch head");
  return sha;
}

export function validRef(branch: string): string {
  if (!isValidBranch(branch)) throw new Error("Invalid branch");
  return `refs/heads/${branch}`;
}

export async function listTags(
  dir: string,
  limit = 20,
): Promise<Array<{ tag: string; date: string }>> {
  const result = await runGit([
    "--git-dir",
    dir,
    "for-each-ref",
    "--sort=-creatordate",
    "--count",
    String(limit),
    // Refnames cannot contain spaces, and iso-strict dates contain none either,
    // so a single space is an unambiguous separator here.
    "--format=%(refname:short) %(creatordate:iso-strict)",
    "refs/tags",
  ]);
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(" ");
      const tag = separator === -1 ? line : line.slice(0, separator);
      const date = separator === -1 ? "" : line.slice(separator + 1).trim();
      return { tag: sanitizeText(tag, 80), date };
    })
    .filter((entry) => entry.tag.length > 0);
}

export function sanitizeText(value: string | null | undefined, maxLength: number): string {
  if (!value) return "";
  return (
    value
      // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately strips control bytes from untrusted git output
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .slice(0, maxLength)
      .trim()
  );
}
