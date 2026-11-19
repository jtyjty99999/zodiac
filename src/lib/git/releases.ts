import type { ReleaseInput } from "../db/repositories/releases";
import { listTags, sanitizeText } from "./mirror";

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

export function parseGithubRepo(repoUrl: string): GithubRepoRef | null {
  const httpsMatch = repoUrl.match(
    /^https?:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/,
  );
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  const sshMatch = repoUrl.match(
    /^git@github\.com:([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/,
  );
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  return null;
}

interface GithubApiRelease {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  body?: unknown;
  draft?: unknown;
}

const RELEASE_TIMEOUT_MS = 15_000;
const MAX_RELEASES = 30;

export function normalizeGithubReleases(payload: unknown): ReleaseInput[] {
  if (!Array.isArray(payload)) return [];

  return payload
    .slice(0, MAX_RELEASES)
    .map((item): ReleaseInput | null => {
      if (typeof item !== "object" || item === null) return null;
      const release = item as GithubApiRelease;
      const tag = sanitizeText(typeof release.tag_name === "string" ? release.tag_name : "", 80);
      if (!tag) return null;
      if (release.draft === true) return null;

      const name = sanitizeText(typeof release.name === "string" ? release.name : "", 200);
      const rawUrl = sanitizeText(
        typeof release.html_url === "string" ? release.html_url : "",
        300,
      );
      const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : "";
      const publishedAt = sanitizeText(
        typeof release.published_at === "string" ? release.published_at : "",
        40,
      );
      const body = sanitizeText(typeof release.body === "string" ? release.body : "", 20_000);

      return {
        tag,
        name: name || tag,
        url: url || null,
        publishedAt: publishedAt || null,
        body: body || null,
      };
    })
    .filter((release): release is ReleaseInput => release !== null);
}

export async function fetchGithubReleases(
  repo: GithubRepoRef,
  token = process.env.GITHUB_TOKEN,
): Promise<ReleaseInput[]> {
  const url = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(
    repo.repo,
  )}/releases?per_page=${MAX_RELEASES}`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "zodiac-agent-tracker",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(RELEASE_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`GitHub releases API responded ${response.status}`);
  }

  return normalizeGithubReleases(await response.json());
}

export async function listTagReleases(dir: string, limit = MAX_RELEASES): Promise<ReleaseInput[]> {
  const tags = await listTags(dir, limit);
  return tags.map((tag) => ({
    tag: tag.tag,
    name: tag.tag,
    url: null,
    publishedAt: tag.date || null,
    body: null,
  }));
}

export async function fetchReleases(
  input: { repoUrl: string; mirrorDir: string },
  token = process.env.GITHUB_TOKEN,
): Promise<{ releases: ReleaseInput[]; source: "github" | "tags" }> {
  const repo = parseGithubRepo(input.repoUrl);
  if (repo) {
    try {
      const releases = await fetchGithubReleases(repo, token);
      if (releases.length > 0) return { releases, source: "github" };
    } catch (error) {
      console.warn(
        `[zodiac] GitHub releases unavailable (${repo.owner}/${repo.repo}):`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return { releases: await listTagReleases(input.mirrorDir), source: "tags" };
}
