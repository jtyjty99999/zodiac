import fs from "node:fs";
import path from "node:path";
import { slugSchema } from "../validation/schemas";
import { ensureSha } from "./log";
import { DATA_DIR } from "./mirror";

export function resolveDataPath(relativePath: string): string {
  const resolved = path.resolve(DATA_DIR, relativePath);
  const root = DATA_DIR.endsWith(path.sep) ? DATA_DIR : `${DATA_DIR}${path.sep}`;
  if (!resolved.startsWith(root)) {
    throw new Error("Refusing to access a path outside the data directory");
  }
  return resolved;
}

export function diffRelativePath(slug: string, sha: string): string {
  if (!slugSchema.safeParse(slug).success) throw new Error("Invalid harness slug");
  return path.posix.join("diffs", slug, `${ensureSha(sha)}.patch`);
}

export function writeDiff(slug: string, sha: string, patch: string): string {
  const relative = diffRelativePath(slug, sha);
  const absolute = resolveDataPath(relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, patch, "utf8");
  return relative;
}

export function readDiff(relativePath: string | null): string | null {
  if (!relativePath) return null;
  try {
    return fs.readFileSync(resolveDataPath(relativePath), "utf8");
  } catch {
    return null;
  }
}
