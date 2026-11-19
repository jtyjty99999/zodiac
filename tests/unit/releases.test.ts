import { describe, expect, test, vi } from "vitest";
import { fetchGithubReleases, normalizeGithubReleases, parseGithubRepo } from "@/lib/git/releases";

describe("parseGithubRepo", () => {
  test("parses https and scp-style remotes", () => {
    expect(parseGithubRepo("https://github.com/openai/codex")).toEqual({
      owner: "openai",
      repo: "codex",
    });
    expect(parseGithubRepo("https://github.com/openai/codex.git")).toEqual({
      owner: "openai",
      repo: "codex",
    });
    expect(parseGithubRepo("git@github.com:anomalyco/opencode.git")).toEqual({
      owner: "anomalyco",
      repo: "opencode",
    });
  });

  test("returns null for non-GitHub remotes", () => {
    expect(parseGithubRepo("https://gitlab.com/a/b")).toBeNull();
    expect(parseGithubRepo("https://github.com/owner")).toBeNull();
    expect(parseGithubRepo("file:///tmp/repo.git")).toBeNull();
  });
});

describe("normalizeGithubReleases", () => {
  test("maps API payloads and fills in defaults", () => {
    const releases = normalizeGithubReleases([
      {
        tag_name: "v1.2.0",
        name: "Version 1.2.0",
        html_url: "https://github.com/a/b/releases/tag/v1.2.0",
        published_at: "2026-11-19T00:00:00Z",
        body: "Release notes",
      },
      { tag_name: "v1.1.0", body: "" },
    ]);
    expect(releases).toEqual([
      {
        tag: "v1.2.0",
        name: "Version 1.2.0",
        url: "https://github.com/a/b/releases/tag/v1.2.0",
        publishedAt: "2026-11-19T00:00:00Z",
        body: "Release notes",
      },
      {
        tag: "v1.1.0",
        name: "v1.1.0",
        url: null,
        publishedAt: null,
        body: null,
      },
    ]);
  });

  test("drops drafts and entries without tags", () => {
    const releases = normalizeGithubReleases([
      { tag_name: "v1", draft: true },
      { name: "no tag" },
      null,
      "nope",
      { tag_name: " v2 " },
    ]);
    expect(releases.map((release) => release.tag)).toEqual(["v2"]);
  });

  test("handles non-array payloads", () => {
    expect(normalizeGithubReleases(null)).toEqual([]);
    expect(normalizeGithubReleases({ message: "rate limited" })).toEqual([]);
  });

  test("caps the number of releases", () => {
    const payload = Array.from({ length: 50 }, (_, index) => ({ tag_name: `v${index}` }));
    expect(normalizeGithubReleases(payload)).toHaveLength(30);
  });

  test("sanitizes control characters in text fields", () => {
    const [release] = normalizeGithubReleases([{ tag_name: "v\u00071", body: "a\u0007b" }]);
    expect(release.tag).toBe("v1");
    expect(release.body).toBe("ab");
  });
});

describe("fetchGithubReleases", () => {
  test("requests the releases endpoint with auth headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ tag_name: "v1.0.0" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const releases = await fetchGithubReleases({ owner: "openai", repo: "codex" }, "token-123");
      expect(releases).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.github.com/repos/openai/codex/releases?per_page=30");
      expect(init.headers.Authorization).toBe("Bearer token-123");
      expect(init.headers.Accept).toBe("application/vnd.github+json");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("omits the auth header without a token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await fetchGithubReleases({ owner: "a", repo: "b" }, "");
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("throws on non-OK responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    try {
      await expect(fetchGithubReleases({ owner: "a", repo: "b" }, "")).rejects.toThrow(
        /responded 403/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
