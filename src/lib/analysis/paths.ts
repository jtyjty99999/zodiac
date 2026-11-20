/**
 * Path-level heuristics shared by commit rating and the heuristic review.
 * They are intentionally narrow: only runtime-critical locations count as
 * "core", and only docs/tests/lockfiles count as mechanical.
 */
const CORE_PATH =
  /(?:^|\/)(?:src\/(?:core|agent|runtime|engine|main|app|session|context)(?:\/|\.)|packages\/(?:core|runtime|engine|agent)\/|crates\/|codex-rs\/(?:core|exec|protocol)|internal\/)/i;
const MECHANICAL_PATH =
  /(?:^|\/)(?:docs?|documentation|tests?|__tests__|fixtures?|examples?|benchmarks?)(?:\/|$)|\.(?:md|mdx|txt|snap)$|(?:package-lock|pnpm-lock|yarn\.lock|Cargo\.lock|go\.sum)$/i;
const TEST_PATH = /(?:^|\/)(?:tests?|__tests__|specs?)(?:\/|$)|\.(?:test|spec)\.[a-z0-9]+$/i;

export function isCorePath(path: string): boolean {
  return CORE_PATH.test(path);
}

export function isMechanicalPath(path: string): boolean {
  return MECHANICAL_PATH.test(path);
}

export function isTestPath(path: string): boolean {
  return TEST_PATH.test(path);
}
