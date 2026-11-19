import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Merges the per-harness analysis parts in seed/parts into seed/baseline.json.
 *
 * Each part was produced by scanning a checkout of the harness repository and
 * covers every taxonomy feature key exactly once. This script fails fast when
 * keys are missing, statuses are invalid, or a deep dive lacks its detail.
 */

const ROOT = process.cwd();
const PARTS_DIR = path.join(ROOT, "seed", "parts");
const TAXONOMY_PATH = path.join(ROOT, "seed", "taxonomy.json");
const DEEPDIVES_PATH = path.join(PARTS_DIR, "_deepdives.json");
const OUTPUT_PATH = path.join(ROOT, "seed", "baseline.json");

const HARNESSES = [
  {
    slug: "codex",
    name: "Codex",
    repoUrl: "https://github.com/openai/codex",
    branch: "main",
    sortOrder: 1,
  },
  {
    slug: "opencode",
    name: "OpenCode",
    repoUrl: "https://github.com/anomalyco/opencode",
    branch: "dev",
    sortOrder: 2,
  },
  {
    slug: "pi",
    name: "Pi",
    repoUrl: "https://github.com/earendil-works/pi",
    branch: "main",
    sortOrder: 3,
  },
  {
    slug: "wave-agent",
    name: "Wave Agent",
    repoUrl: "https://github.com/netease-lcap/wave-agent",
    branch: "main",
    sortOrder: 4,
  },
] as const;

const supportStatus = z.enum(["yes", "partial", "no", "unknown"]);

const partFeatureSchema = z.object({
  status: supportStatus,
  notes: z.string().max(4000),
  evidence: z.string().max(4000),
  detailMd: z.string().max(20_000).optional(),
  detailEvidence: z.string().max(4000).optional(),
});

const partSchema = z.object({
  slug: z.string(),
  repo: z.string(),
  analyzedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  features: z.record(z.string(), partFeatureSchema),
});

const taxonomySchema = z.object({
  version: z.string(),
  features: z.array(
    z.object({
      key: z.string(),
      isDeepDive: z.boolean().optional(),
    }),
  ),
});

const deepDiveSchema = z.record(
  z.string(),
  z.object({
    overviewMd: z.string().min(1).max(20_000),
    diffSummaryMd: z.string().min(1).max(20_000),
  }),
);

function readJson(file: string): unknown {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${path.relative(ROOT, file)}`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

function build(): void {
  const taxonomy = taxonomySchema.parse(readJson(TAXONOMY_PATH));
  const deepDives = deepDiveSchema.parse(readJson(DEEPDIVES_PATH));
  const featureKeys = taxonomy.features.map((feature) => feature.key);

  const parts = HARNESSES.map((harness) => {
    const part = partSchema.parse(readJson(path.join(PARTS_DIR, `${harness.slug}.json`)));
    if (part.slug !== harness.slug) {
      throw new Error(`Part ${harness.slug} reports slug ${part.slug}`);
    }
    if (part.repo !== harness.repoUrl) {
      throw new Error(`Part ${harness.slug} repo ${part.repo} != ${harness.repoUrl}`);
    }
    const partKeys = Object.keys(part.features);
    if (partKeys.length !== featureKeys.length) {
      throw new Error(
        `Part ${harness.slug} has ${partKeys.length} features, expected ${featureKeys.length}`,
      );
    }
    for (const key of featureKeys) {
      if (!(key in part.features)) throw new Error(`Part ${harness.slug} missing ${key}`);
    }
    return { harness, part };
  });

  const features = taxonomy.features.map((feature) => {
    const support: Record<string, { status: string; notes: string; evidence: string }> = {};
    const details: Record<string, { detailMd: string; evidence: string | null }> = {};
    for (const { harness, part } of parts) {
      const entry = part.features[feature.key];
      support[harness.slug] = {
        status: entry.status,
        notes: entry.notes,
        evidence: entry.evidence,
      };
      if (feature.isDeepDive) {
        if (!entry.detailMd) {
          throw new Error(`Deep dive ${feature.key} missing detail for ${harness.slug}`);
        }
        details[harness.slug] = {
          detailMd: entry.detailMd,
          evidence: entry.detailEvidence ?? entry.evidence,
        };
      }
    }
    if (feature.isDeepDive && !(feature.key in deepDives)) {
      throw new Error(`Deep dive ${feature.key} missing overview/diff summary`);
    }
    const summary = feature.isDeepDive ? deepDives[feature.key] : null;
    return {
      key: feature.key,
      overviewMd: summary?.overviewMd ?? null,
      diffSummaryMd: summary?.diffSummaryMd ?? null,
      support,
      details,
    };
  });

  const baseline = {
    version: taxonomy.version,
    note: "初始基线：按 13 个模块覆盖 codex / opencode / pi / wave-agent 四个 harness 的功能矩阵，并对 12 个核心功能记录实现细节。",
    harnesses: HARNESSES.map((harness) => ({
      ...harness,
      scheduleMode: "daily",
      dailyTime: "09:17",
      backfillDays: 30,
      enabled: true,
    })),
    features,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  const statusCounts = new Map<string, number>();
  for (const feature of features) {
    for (const entry of Object.values(feature.support)) {
      statusCounts.set(entry.status, (statusCounts.get(entry.status) ?? 0) + 1);
    }
  }
  process.stdout.write(
    `Wrote ${path.relative(ROOT, OUTPUT_PATH)}: ${features.length} features, ` +
      `${HARNESSES.length} harnesses, status counts ${JSON.stringify(Object.fromEntries(statusCounts))}\n`,
  );
}

build();
