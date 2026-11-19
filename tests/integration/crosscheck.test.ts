import { describe, expect, test } from "vitest";
import { CROSS_CHECK_NOTE, crossCheckCandidate, searchCommits } from "@/lib/analysis/crossCheck";
import { createCandidate, listCandidateChecks } from "@/lib/db/repositories/candidates";
import { createHarness } from "@/lib/db/repositories/harnesses";
import { ensureMirror } from "@/lib/git/mirror";
import { createTempRepo, makeDb } from "./helpers";

describe("crossCheckCandidate", () => {
  test("searches other mirrors and records advisory evidence", async () => {
    const db = makeDb();
    const source = createTempRepo([
      {
        subject: "feat: add subagent delegation",
        files: { "src/agents.ts": "export const a = 1;\n" },
      },
    ]);
    const target = createTempRepo([
      {
        subject: "feat: introduce subagent delegation for long tasks",
        files: { "src/multi.ts": "export const m = 1;\n" },
      },
    ]);

    const sourceHarness = createHarness(db, {
      slug: "source",
      name: "Source",
      repoUrl: source.url,
    }).harness;
    const targetHarness = createHarness(db, {
      slug: "target-a",
      name: "Target",
      repoUrl: target.url,
    }).harness;
    const offline = createHarness(db, {
      slug: "offline",
      name: "Offline",
      repoUrl: "https://github.com/a/offline",
    }).harness;

    await ensureMirror({
      slug: "target-a",
      repoUrl: target.url,
      branch: "main",
      allowLocalRepo: true,
    });

    const candidate = createCandidate(db, {
      harnessId: sourceHarness.id,
      name: "Subagent delegation",
      description: "delegate tasks to child agents",
      createdDay: "2026-11-19",
    });

    const checks = await crossCheckCandidate(db, candidate.id);
    const targetCheck = checks.find((check) => check.harnessId === targetHarness.id);
    expect(targetCheck?.status).toBe("yes");
    expect(targetCheck?.evidence).toContain("subagent delegation");
    expect(targetCheck?.note).toBe(CROSS_CHECK_NOTE);
    // The source harness is never checked against itself.
    expect(checks.find((check) => check.harnessId === sourceHarness.id)).toBeUndefined();

    const offlineCheck = checks.find((check) => check.harnessId === offline.id);
    expect(offlineCheck?.status).toBe("unknown");
    expect(offlineCheck?.note).toContain("尚未建立本地镜像");

    // Checks are persisted and upserted, not duplicated.
    expect(listCandidateChecks(db, candidate.id)).toHaveLength(checks.length);
    await crossCheckCandidate(db, candidate.id);
    expect(listCandidateChecks(db, candidate.id)).toHaveLength(checks.length);
  });

  test("marks harnesses as unknown when no matching commits are found", async () => {
    const db = makeDb();
    const source = createTempRepo([
      { subject: "feat: add subagent delegation", files: { "src/agents.ts": "x\n" } },
    ]);
    const target = createTempRepo([
      { subject: "docs: update readme", files: { "README.md": "hello\n" } },
    ]);
    const sourceHarness = createHarness(db, {
      slug: "source",
      name: "Source",
      repoUrl: source.url,
    }).harness;
    const targetHarness = createHarness(db, {
      slug: "target-b",
      name: "Target",
      repoUrl: target.url,
    }).harness;
    await ensureMirror({
      slug: "target-b",
      repoUrl: target.url,
      branch: "main",
      allowLocalRepo: true,
    });

    const candidate = createCandidate(db, {
      harnessId: sourceHarness.id,
      name: "Subagent delegation",
      createdDay: "2026-11-19",
    });
    const checks = await crossCheckCandidate(db, candidate.id);
    const targetCheck = checks.find((check) => check.harnessId === targetHarness.id);
    expect(targetCheck?.status).toBe("unknown");
    expect(targetCheck?.note).toContain("未检索到");
  });

  test("throws for unknown candidates", async () => {
    const db = makeDb();
    await expect(crossCheckCandidate(db, 999)).rejects.toThrow(/Candidate not found/);
  });
});

describe("searchCommits", () => {
  test("finds commits by fixed-string grep and sanitises output", async () => {
    const repo = createTempRepo([
      { subject: "feat: sandbox bubblewrap support", files: { "src/sandbox.ts": "x\n" } },
      { subject: "docs: about sandboxing", files: { "docs/sandbox.md": "y\n" } },
    ]);
    const mirror = await ensureMirror({
      slug: "search",
      repoUrl: repo.url,
      branch: "main",
      allowLocalRepo: true,
    });
    const matches = await searchCommits(mirror.dir, "bubblewrap");
    expect(matches).toHaveLength(1);
    expect(matches[0].sha).toMatch(/^[0-9a-f]{40}$/);
    expect(matches[0].subject).toContain("bubblewrap");
    expect(matches[0].date).toContain("2026-11-18");
  });
});
