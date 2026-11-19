import { runGit, sanitizeText, validRef } from "./mirror";

const FIELD = "\u0000";
const RECORD = "\u001e";
// execFile rejects arguments containing literal NUL bytes, so the record and
// field separators are expressed with git's %xNN escapes instead. Git expands
// them in the output, which parseLog splits on.
const LOG_FORMAT = "--format=%x1e%H%x00%cI%x00%an%x00%s%x00%b%x00";

export interface LoggedFile {
  status: string;
  path: string;
}

export interface LoggedCommit {
  sha: string;
  committerDate: string;
  author: string;
  subject: string;
  body: string;
  files: LoggedFile[];
}

export function parseLog(raw: string): LoggedCommit[] {
  const commits: LoggedCommit[] = [];

  for (const segment of raw.split(RECORD)) {
    const cleaned = segment.replace(/^\r?\n/, "");
    if (!cleaned.trim()) continue;

    const parts = cleaned.split(FIELD);
    const sha = (parts[0] ?? "").trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) continue;

    const filesBlock = parts[5] ?? "";
    const files = filesBlock
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseNameStatusLine)
      .filter((entry): entry is LoggedFile => entry !== null);

    commits.push({
      sha,
      committerDate: normalizeDate(parts[1] ?? ""),
      author: sanitizeText(parts[2], 200) || "unknown",
      subject: sanitizeText(parts[3], 500) || "(no subject)",
      body: sanitizeText(parts[4], 8000),
      files,
    });
  }

  return commits;
}

function parseNameStatusLine(line: string): LoggedFile | null {
  const tabIndex = line.indexOf("\t");
  if (tabIndex <= 0) return null;
  const status = line.slice(0, tabIndex).trim();
  const path = sanitizeText(line.slice(tabIndex + 1), 1000);
  if (!path) return null;
  return { status, path };
}

function normalizeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date(0).toISOString();
  return date.toISOString();
}

export interface ReadLogOptions {
  branch: string;
  fromSha?: string | null;
  /** Page endpoint: walk history reachable from this commit (exclusive of fromSha). */
  toSha?: string | null;
  maxCount?: number;
}

export function ensureSha(sha: string): string {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error("Invalid commit SHA");
  return sha.toLowerCase();
}

export async function readLog(dir: string, options: ReadLogOptions): Promise<LoggedCommit[]> {
  const maxCount = Math.min(Math.max(options.maxCount ?? 300, 1), 2000);
  const endRef = options.toSha ? ensureSha(options.toSha) : validRef(options.branch);
  const range = options.fromSha ? `${ensureSha(options.fromSha)}..${endRef}` : endRef;

  const result = await runGit([
    "--git-dir",
    dir,
    "log",
    "--no-merges",
    "--date-order",
    `--max-count=${maxCount}`,
    LOG_FORMAT,
    "--name-status",
    range,
  ]);

  return parseLog(result.stdout);
}

export interface NumstatFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface NumstatResult {
  files: NumstatFile[];
  insertions: number;
  deletions: number;
}

const MAX_NUMSTAT_FILES = 2_000;

export function parseNumstat(raw: string): NumstatResult {
  const files: NumstatFile[] = [];
  let insertions = 0;
  let deletions = 0;

  for (const line of raw.split("\n")) {
    if (files.length >= MAX_NUMSTAT_FILES) break;
    if (!line.trim()) continue;
    const [addRaw, delRaw, ...pathParts] = line.split("\t");
    const path = sanitizeText(pathParts.join("\t"), 1000);
    if (!path) continue;
    const additions = addRaw === "-" ? 0 : Number.parseInt(addRaw, 10);
    const removed = delRaw === "-" ? 0 : Number.parseInt(delRaw, 10);
    const safeAdd = Number.isFinite(additions) ? Math.max(additions, 0) : 0;
    const safeDel = Number.isFinite(removed) ? Math.max(removed, 0) : 0;
    files.push({ path, additions: safeAdd, deletions: safeDel });
    insertions += safeAdd;
    deletions += safeDel;
  }

  return { files, insertions, deletions };
}

export async function readNumstat(dir: string, sha: string): Promise<NumstatResult> {
  const result = await runGit(["--git-dir", dir, "show", "--numstat", "--format=", ensureSha(sha)]);
  return parseNumstat(result.stdout);
}

export const MAX_PATCH_CHARS = 160_000;

export async function readPatch(
  dir: string,
  sha: string,
  maxChars = MAX_PATCH_CHARS,
): Promise<{ patch: string; truncated: boolean }> {
  const result = await runGit([
    "--git-dir",
    dir,
    "show",
    "--patch",
    "--no-color",
    "--no-ext-diff",
    "--format=",
    ensureSha(sha),
  ]);
  const full = result.stdout.replace(/\r\n/g, "\n");
  if (full.length <= maxChars) {
    return { patch: full, truncated: false };
  }
  return { patch: full.slice(0, maxChars), truncated: true };
}

export async function commitExists(dir: string, sha: string): Promise<boolean> {
  try {
    await runGit(["--git-dir", dir, "cat-file", "-e", `${ensureSha(sha)}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}
