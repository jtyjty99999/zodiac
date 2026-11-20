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
  maxDirEntries: 300,
  maxGrepResults: 60,
  maxReadLines: 120,
  browseTimeoutMs: 15_000,
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

export interface FileRankContext {
  /** Files matched by each pattern, used to weight specific patterns higher. */
  patternSets: Set<string>[];
  patterns: string[];
  totalFiles: number;
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

/**
 * Parses `git grep -l` output (`<rev>:<path>` lines) into unique safe paths.
 */
export function parseGrepPaths(
  stdout: string,
  rev: string,
  maxLines: number = SEARCH_LIMITS.maxGrepLines,
): { paths: string[]; truncated: boolean } {
  const prefix = `${rev}:`;
  const lines = stdout.split("\n").filter(Boolean);
  const truncated = lines.length > maxLines;
  const paths = new Set<string>();

  for (const line of lines.slice(0, maxLines)) {
    const path = line.startsWith(prefix) ? line.slice(prefix.length) : line;
    if (!isSafeRepoPath(path)) continue;
    paths.add(path);
  }

  return { paths: [...paths], truncated };
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

/**
 * Weights each pattern by how selective it is (IDF over matched files) and
 * rewards files that match several distinct patterns or carry a pattern in
 * their path. Generic words like "task" then stop outranking specific ones.
 */
function weightedScore(match: SearchFileMatch, context: FileRankContext): number {
  const corpus = Math.max(1, context.totalFiles);
  let score = 0;
  for (const set of context.patternSets) {
    if (!set.has(match.path)) continue;
    score += Math.log(1 + corpus / (1 + set.size));
  }

  const pathLower = match.path.toLowerCase();
  let pathHits = 0;
  for (const pattern of context.patterns) {
    const normalized = pattern.toLowerCase().replace(/[ -_]+/g, "_");
    if (normalized.length >= 3 && pathLower.includes(normalized)) pathHits += 1;
  }
  return score + Math.min(pathHits, 3) * 1.5 + pathScore(match) * 0.5;
}

/** Drops vendored/binary/lock files and ranks the rest by specificity and locality. */
export function rankFileMatches(
  files: SearchFileMatch[],
  maxFiles: number = SEARCH_LIMITS.maxCandidateFiles,
  context?: FileRankContext,
): SearchFileMatch[] {
  const ranked = files.filter(
    (file) =>
      !NOISE_PATH.test(file.path) && !BINARY_EXT.test(file.path) && !LOCKFILE.test(file.path),
  );

  if (!context) {
    ranked.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      const scoreDiff = pathScore(b) - pathScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return a.path.localeCompare(b.path);
    });
    return ranked.slice(0, maxFiles);
  }

  const scores = new Map<string, number>();
  for (const file of ranked) scores.set(file.path, weightedScore(file, context));
  ranked.sort((a, b) => {
    const scoreDiff = (scores.get(b.path) ?? 0) - (scores.get(a.path) ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    if (b.total !== a.total) return b.total - a.total;
    return a.path.localeCompare(b.path);
  });
  return ranked.slice(0, maxFiles);
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

const GREP_TIMEOUT_ENV = { GIT_NO_LAZY_FETCH: "1", GIT_LITERAL_PATHSPECS: "1" } as const;

export interface DirectoryEntry {
  name: string;
  type: "dir" | "file";
}

/** Lists one directory level of a mirror at `rev` for AI-guided browsing. */
export async function listDirectory(
  dir: string,
  rev: string,
  pathPrefix = "",
  maxEntries: number = SEARCH_LIMITS.maxDirEntries,
): Promise<{ entries: DirectoryEntry[]; truncated: boolean }> {
  if (!SHA_PATTERN.test(rev)) throw new Error("Invalid revision");
  const prefix = pathPrefix.trim().replace(/\/+$/, "");
  if (prefix && !isSafeRepoPath(prefix)) throw new Error("Invalid path");
  const target = prefix ? `${rev}:${prefix}` : rev;

  const { stdout } = await runGit(["--git-dir", dir, "ls-tree", target], {
    timeoutMs: SEARCH_LIMITS.browseTimeoutMs,
    env: GREP_TIMEOUT_ENV,
  });

  const entries: DirectoryEntry[] = [];
  let truncated = false;
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const [, type] = line.slice(0, tab).split(" ");
    const name = line.slice(tab + 1);
    if (!name || name.includes("/")) continue;
    if (entries.length >= maxEntries) {
      truncated = true;
      break;
    }
    entries.push({ name, type: type === "tree" ? "dir" : "file" });
  }
  return { entries, truncated };
}

export interface GrepLine {
  path: string;
  line: number;
  text: string;
}

/** Case-insensitive literal grep with line numbers; bounded for AI tool calls. */
export async function grepCode(
  dir: string,
  rev: string,
  pattern: string,
  options: { pathPrefix?: string; maxMatches?: number } = {},
): Promise<{ lines: GrepLine[]; truncated: boolean }> {
  if (!SHA_PATTERN.test(rev)) throw new Error("Invalid revision");
  const literal = pattern.trim();
  if (!isValidSearchPattern(literal)) throw new Error("Invalid pattern");
  const prefix = options.pathPrefix?.trim().replace(/\/+$/, "") ?? "";
  if (prefix && !isSafeRepoPath(prefix)) throw new Error("Invalid path");
  const maxMatches = options.maxMatches ?? SEARCH_LIMITS.maxGrepResults;

  const args = [
    "--git-dir",
    dir,
    "grep",
    "-n",
    "-m",
    "2",
    "-I",
    "-i",
    "-F",
    "--no-color",
    "-e",
    literal,
    rev,
    "--",
  ];
  if (prefix) args.push(prefix);

  const { stdout } = await runGit(args, {
    allowExitCodes: [1],
    timeoutMs: SEARCH_LIMITS.browseTimeoutMs,
    env: GREP_TIMEOUT_ENV,
  });

  const revPrefix = `${rev}:`;
  const lines: GrepLine[] = [];
  let truncated = false;
  for (const raw of stdout.split("\n")) {
    if (!raw) continue;
    const rest = raw.startsWith(revPrefix) ? raw.slice(revPrefix.length) : raw;
    const match = rest.match(/^(.*):(\d+):(.*)$/);
    if (!match) continue;
    const filePath = match[1];
    if (!isSafeRepoPath(filePath)) continue;
    if (lines.length >= maxMatches) {
      truncated = true;
      break;
    }
    lines.push({
      path: filePath,
      line: Number.parseInt(match[2], 10),
      text: truncateLine(match[3], 240),
    });
  }
  return { lines, truncated };
}

/** Reads a numbered, bounded window of a text file for AI tool calls. */
export async function readBlobLines(
  dir: string,
  rev: string,
  filePath: string,
  options: { startLine?: number; maxLines?: number } = {},
): Promise<{ lines: string[]; truncated: boolean } | null> {
  const content = await readBlob(dir, rev, filePath);
  if (content === null) return null;
  const all = content.split("\n");
  const start = Math.max(1, Math.floor(options.startLine ?? 1));
  const maxLines = Math.min(
    Math.max(1, Math.floor(options.maxLines ?? SEARCH_LIMITS.maxReadLines)),
    SEARCH_LIMITS.maxReadLines,
  );
  const slice = all.slice(start - 1, start - 1 + maxLines);
  return {
    lines: slice.map((line, offset) => `${start + offset}: ${truncateLine(line, 240)}`),
    truncated: start - 1 + slice.length < all.length,
  };
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
  const timeoutMs = options.timeoutMs ?? SEARCH_LIMITS.grepTimeoutMs;
  const env = { GIT_NO_LAZY_FETCH: "1", GIT_LITERAL_PATHSPECS: "1" };

  const countsArgs = ["--git-dir", dir, "grep", "-c", "-I", "-i", "-F", "--no-color"];
  for (const pattern of normalized) countsArgs.push("-e", pattern);
  countsArgs.push(rev, "--");

  // One combined pass for exact counts and one `-l` pass per pattern so
  // ranking can tell a specific term from a generic one.
  const listPatternFiles = async (pattern: string): Promise<Set<string> | null> => {
    try {
      const { stdout } = await runGit(
        ["--git-dir", dir, "grep", "-l", "-I", "-i", "-F", "--no-color", "-e", pattern, rev, "--"],
        { allowExitCodes: [1], timeoutMs, env },
      );
      return new Set(parseGrepPaths(stdout, rev).paths);
    } catch {
      return null;
    }
  };

  const [counts, ...patternSets] = await Promise.all([
    runGit(countsArgs, { allowExitCodes: [1], timeoutMs, env }),
    ...normalized.map(listPatternFiles),
  ]);

  const parsed = parseGrepCounts(counts.stdout, rev);
  const totalFiles = parsed.files.length;
  const totalMatches = parsed.files.reduce((sum, file) => sum + file.total, 0);
  const sets = patternSets.every((set): set is Set<string> => set !== null) ? patternSets : null;
  const candidates = rankFileMatches(
    parsed.files,
    SEARCH_LIMITS.maxCandidateFiles,
    sets ? { patternSets: sets, patterns: normalized, totalFiles } : undefined,
  );
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
