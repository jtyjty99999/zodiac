import { runGit } from "./mirror";

export const SEARCH_LIMITS = {
  maxPatterns: 8,
  maxCandidateFiles: 40,
  maxFiles: 8,
  maxSnippetsPerFile: 3,
  maxSnippetChars: 300,
  maxSnippetBlockChars: 1200,
  maxBlobBytes: 256 * 1024,
  maxGrepLines: 20_000,
  contextLines: 2,
  grepTimeoutMs: 20_000,
  blobTimeoutMs: 10_000,
} as const;

export interface SearchFileMatch {
  path: string;
  total: number;
}

export interface SearchFileResult {
  path: string;
  total: number;
  snippets: Array<{ line: number; text: string }>;
}

export interface MirrorSearchResult {
  rev: string;
  files: SearchFileResult[];
  totalFiles: number;
  totalMatches: number;
  truncated: boolean;
  notes: string[];
}

export interface SearchOptions {
  maxFiles?: number;
  maxSnippetsPerFile?: number;
  maxBlobBytes?: number;
  timeoutMs?: number;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/;

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejects control bytes in untrusted paths/patterns
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const NOISE_PATH =
  /(^|\/)(node_modules|vendor|dist|build|target|__snapshots__|snapshots?|fixtures?|coverage)\//i;
const TEST_PATH = /(^|\/)(__tests__|tests?|spec|specs)\//i;
const BINARY_EXT =
  /\.(png|jpe?g|gif|svg|ico|webp|bmp|pdf|zip|gz|tgz|tar|woff2?|ttf|otf|eot|mp[34]|mov|lock)$/i;
const LOCKFILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock)$/i;
const SOURCE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|rs|py|go|java|kt|swift|rb|c|h|cc|cpp|hpp|cs|php|scala|sh|bash|zsh|toml|ya?ml|json)$/i;

/** A literal `git grep -F` pattern. Must not be empty, an option, or a control string. */
export function isValidSearchPattern(value: string): boolean {
  const pattern = value.trim();
  if (pattern.length < 2 || pattern.length > 80) return false;
  if (pattern.startsWith("-")) return false;
  return !CONTROL_CHARS.test(pattern);
}

/** A repository-relative path safe to pass to `git cat-file` and as a pathspec. */
export function isSafeRepoPath(value: string): boolean {
  if (!value || value.length > 400) return false;
  if (CONTROL_CHARS.test(value)) return false;
  if (value.startsWith("/") || value.startsWith("-")) return false;
  const segments = value.split("/");
  return !segments.some((segment) => segment === ".." || segment === "");
}

function normalizePatterns(
  patterns: string[],
  maxPatterns: number = SEARCH_LIMITS.maxPatterns,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of patterns) {
    const pattern = raw.trim();
    if (!isValidSearchPattern(pattern)) continue;
    const key = pattern.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(pattern);
    if (result.length >= maxPatterns) break;
  }
  return result;
}

/**
 * Parses `git grep -c` output. Each line is `<rev>:<path>:<count>`; the rev is a
 * resolved 40-hex SHA, so stripping it first is unambiguous.
 */
export function parseGrepCounts(
  stdout: string,
  rev: string,
  maxLines: number = SEARCH_LIMITS.maxGrepLines,
): { files: SearchFileMatch[]; truncated: boolean } {
  const prefix = `${rev}:`;
  const lines = stdout.split("\n").filter(Boolean);
  const truncated = lines.length > maxLines;
  const byPath = new Map<string, number>();

  for (const line of lines.slice(0, maxLines)) {
    const rest = line.startsWith(prefix) ? line.slice(prefix.length) : line;
    const separator = rest.lastIndexOf(":");
    if (separator <= 0) continue;
    const path = rest.slice(0, separator);
    const total = Number.parseInt(rest.slice(separator + 1), 10);
    if (!Number.isFinite(total) || total <= 0) continue;
    if (!isSafeRepoPath(path)) continue;
    byPath.set(path, (byPath.get(path) ?? 0) + total);
  }

  return {
    files: [...byPath.entries()].map(([path, total]) => ({ path, total })),
    truncated,
  };
}

function pathDepth(path: string): number {
  return path.split("/").length;
}

function pathScore(match: SearchFileMatch): number {
  let score = 0;
  if (SOURCE_EXT.test(match.path)) score += 3;
  else if (/\.md$/i.test(match.path)) score += 1;
  const depth = pathDepth(match.path);
  if (depth <= 4) score += 2;
  else if (depth <= 6) score += 1;
  if (TEST_PATH.test(match.path)) score -= 2;
  if (/(^|\/)docs?\//i.test(match.path)) score -= 1;
  return score;
}

/** Drops vendored/binary/lock files and ranks the rest by hit count and locality. */
export function rankFileMatches(
  files: SearchFileMatch[],
  maxFiles: number = SEARCH_LIMITS.maxCandidateFiles,
): SearchFileMatch[] {
  return files
    .filter(
      (file) =>
        !NOISE_PATH.test(file.path) && !BINARY_EXT.test(file.path) && !LOCKFILE.test(file.path),
    )
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      const scoreDiff = pathScore(b) - pathScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return a.path.localeCompare(b.path);
    })
    .slice(0, maxFiles);
}

function truncateLine(line: string, maxChars: number = SEARCH_LIMITS.maxSnippetChars): string {
  const trimmed = line.replace(/\s+$/, "");
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
}

/** Builds numbered context blocks around matching lines, capped per file. */
export function buildSnippets(
  content: string,
  patterns: string[],
  options: { maxSnippets?: number; contextLines?: number } = {},
): Array<{ line: number; text: string }> {
  const maxSnippets = options.maxSnippets ?? SEARCH_LIMITS.maxSnippetsPerFile;
  const contextLines = options.contextLines ?? SEARCH_LIMITS.contextLines;
  const lowered = patterns.map((pattern) => pattern.toLowerCase()).filter(Boolean);
  if (lowered.length === 0) return [];

  const lines = content.split("\n");
  const snippets: Array<{ line: number; text: string }> = [];
  const seen = new Set<number>();

  for (let index = 0; index < lines.length && snippets.length < maxSnippets; index += 1) {
    const haystack = lines[index].toLowerCase();
    if (!lowered.some((pattern) => haystack.includes(pattern))) continue;
    if (seen.has(index)) continue;
    seen.add(index);

    const start = Math.max(0, index - contextLines);
    const end = Math.min(lines.length - 1, index + contextLines);
    const block = lines
      .slice(start, end + 1)
      .map((line, offset) => `${start + offset + 1}: ${truncateLine(line)}`)
      .join("\n");
    snippets.push({
      line: index + 1,
      text:
        block.length > SEARCH_LIMITS.maxSnippetBlockChars
          ? `${block.slice(0, SEARCH_LIMITS.maxSnippetBlockChars)}…`
          : block,
    });
  }

  return snippets;
}

/**
 * Reads one text blob from a mirror. Oversized or binary blobs are skipped
 * rather than truncated mid-file.
 */
export async function readBlob(
  dir: string,
  rev: string,
  path: string,
  maxBytes: number = SEARCH_LIMITS.maxBlobBytes,
): Promise<string | null> {
  if (!SHA_PATTERN.test(rev) || !isSafeRepoPath(path)) return null;
  const object = `${rev}:${path}`;
  const env = { GIT_NO_LAZY_FETCH: "1", GIT_LITERAL_PATHSPECS: "1" };

  try {
    const sized = await runGit(["--git-dir", dir, "cat-file", "-s", object], {
      timeoutMs: SEARCH_LIMITS.blobTimeoutMs,
      env,
    });
    const size = Number.parseInt(sized.stdout.trim(), 10);
    if (!Number.isFinite(size) || size < 0 || size > maxBytes) return null;

    const blob = await runGit(["--git-dir", dir, "cat-file", "blob", object], {
      timeoutMs: SEARCH_LIMITS.blobTimeoutMs,
      env,
    });
    if (blob.stdout.includes("\u0000")) return null;
    return blob.stdout;
  } catch {
    return null;
  }
}

/**
 * Searches a bare mirror at a resolved revision with literal, case-insensitive
 * patterns: one `grep -c` pass to rank files, then bounded blob reads for
 * snippets. Runs entirely against local objects.
 */
export async function searchMirror(
  dir: string,
  rev: string,
  patterns: string[],
  options: SearchOptions = {},
): Promise<MirrorSearchResult> {
  if (!SHA_PATTERN.test(rev)) throw new Error("Invalid revision");
  const normalized = normalizePatterns(patterns);
  if (normalized.length === 0) throw new Error("没有可用的检索关键词");

  const maxFiles = options.maxFiles ?? SEARCH_LIMITS.maxFiles;
  const maxSnippetsPerFile = options.maxSnippetsPerFile ?? SEARCH_LIMITS.maxSnippetsPerFile;
  const maxBlobBytes = options.maxBlobBytes ?? SEARCH_LIMITS.maxBlobBytes;

  const args = ["--git-dir", dir, "grep", "-c", "-I", "-i", "-F", "--no-color"];
  for (const pattern of normalized) args.push("-e", pattern);
  args.push(rev, "--");

  const { stdout } = await runGit(args, {
    allowExitCodes: [1],
    timeoutMs: options.timeoutMs ?? SEARCH_LIMITS.grepTimeoutMs,
    env: { GIT_NO_LAZY_FETCH: "1", GIT_LITERAL_PATHSPECS: "1" },
  });

  const parsed = parseGrepCounts(stdout, rev);
  const totalFiles = parsed.files.length;
  const totalMatches = parsed.files.reduce((sum, file) => sum + file.total, 0);
  const candidates = rankFileMatches(parsed.files);
  const notes: string[] = [];
  const files: SearchFileResult[] = [];

  for (const candidate of candidates) {
    if (files.length >= maxFiles) break;
    const content = await readBlob(dir, rev, candidate.path, maxBlobBytes);
    if (content === null) {
      notes.push(`已跳过 ${candidate.path}（二进制、过大或无法读取）`);
      continue;
    }
    const snippets = buildSnippets(content, normalized, { maxSnippets: maxSnippetsPerFile });
    if (snippets.length === 0) continue;
    files.push({ path: candidate.path, total: candidate.total, snippets });
  }

  return {
    rev,
    files,
    totalFiles,
    totalMatches,
    truncated: parsed.truncated || totalFiles > maxFiles,
    notes,
  };
}
