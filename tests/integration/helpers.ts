import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Db, openDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";

export function makeDb(): Db {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

export interface TempRepoCommit {
  subject: string;
  body?: string;
  files: Record<string, string>;
  tag?: string;
}

export interface TempRepo {
  dir: string;
  url: string;
  shas: string[];
}

function git(cwd: string, args: string[], env: Record<string, string> = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  }).trim();
}

/**
 * Creates a throwaway local git repository with deterministic commits so the
 * mirror/ingest pipeline can be exercised without network access.
 */
export function createTempRepo(commits: TempRepoCommit[], branch = "main"): TempRepo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zodiac-origin-"));
  git(dir, ["init", "-q", "-b", branch]);
  git(dir, ["config", "user.name", "Test Author"]);
  git(dir, ["config", "user.email", "test@zodiac.local"]);
  git(dir, ["config", "commit.gpgsign", "false"]);

  const shas: string[] = [];
  commits.forEach((commit, index) => {
    shas.push(appendCommit(dir, commit, index));
  });

  return { dir, url: `file://${dir}`, shas };
}

/**
 * Adds a commit to an existing temp repository and returns its SHA.
 */
export function appendCommit(dir: string, commit: TempRepoCommit, index = 0): string {
  for (const [relativePath, content] of Object.entries(commit.files)) {
    const absolute = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");
  }
  git(dir, ["add", "-A"]);
  const date = new Date(Date.UTC(2026, 10, 18, 12, index, 0)).toISOString();
  const args = ["commit", "-q", "-m", commit.subject];
  if (commit.body) args.push("-m", commit.body);
  git(dir, args, {
    GIT_AUTHOR_NAME: "Test Author",
    GIT_AUTHOR_EMAIL: "test@zodiac.local",
    GIT_COMMITTER_NAME: "Test Author",
    GIT_COMMITTER_EMAIL: "test@zodiac.local",
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
  const sha = git(dir, ["rev-parse", "HEAD"]);
  if (commit.tag) git(dir, ["tag", commit.tag]);
  return sha;
}
