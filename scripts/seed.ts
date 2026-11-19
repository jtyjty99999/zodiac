import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ensureInitialCatalogVersion } from "../src/lib/catalog/versions";
import { getDb } from "../src/lib/db/client";
import { createCandidate } from "../src/lib/db/repositories/candidates";
import {
  getFeatureByKey,
  setFeatureSupport,
  updateFeatureContent,
  upsertFeatureDetail,
  upsertTaxonomy,
} from "../src/lib/db/repositories/catalog";
import { updateCommitAnalysis, upsertCommits } from "../src/lib/db/repositories/commits";
import { createHarness, getHarnessBySlug } from "../src/lib/db/repositories/harnesses";
import { upsertReleases } from "../src/lib/db/repositories/releases";
import type { CommitCategory } from "../src/lib/types";
import { addDays, toDay } from "../src/lib/utils/time";

const ROOT = process.cwd();
const TAXONOMY_PATH = path.join(ROOT, "seed", "taxonomy.json");
const BASELINE_PATH = path.join(ROOT, "seed", "baseline.json");

const supportStatus = z.enum(["yes", "partial", "no", "unknown"]);

const baselineSchema = z.object({
  version: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(500).optional(),
  harnesses: z
    .array(
      z.object({
        slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,49}$/),
        name: z.string().min(1).max(80),
        repoUrl: z.string().min(1).max(300),
        branch: z.string().min(1).max(200).default("main"),
        scheduleMode: z.enum(["off", "hourly", "daily"]).default("daily"),
        dailyTime: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .default("09:17"),
        backfillDays: z.number().int().min(1).max(3650).default(30),
        sortOrder: z.number().int().min(0).max(10_000).default(100),
        enabled: z.boolean().default(true),
      }),
    )
    .min(1),
  features: z.array(
    z.object({
      key: z.string().min(3).max(120),
      overviewMd: z.string().max(20_000).nullable().optional(),
      diffSummaryMd: z.string().max(20_000).nullable().optional(),
      support: z
        .record(
          z.string(),
          z.object({
            status: supportStatus,
            notes: z.string().max(4000).nullable().optional(),
            evidence: z.string().max(4000).nullable().optional(),
            sinceVersion: z.string().max(80).nullable().optional(),
          }),
        )
        .default({}),
      details: z
        .record(
          z.string(),
          z.object({
            detailMd: z.string().max(20_000),
            evidence: z.string().max(4000).nullable().optional(),
          }),
        )
        .default({}),
    }),
  ),
});

const taxonomySchema = z.object({
  version: z.string().optional(),
  modules: z.array(
    z.object({
      key: z.string().min(1).max(60),
      name: z.string().min(1).max(80),
      description: z.string().max(1000).nullable().optional(),
      sortOrder: z.number().int().default(0),
    }),
  ),
  features: z.array(
    z.object({
      key: z.string().min(3).max(120),
      module: z.string().min(1).max(60),
      name: z.string().min(1).max(120),
      description: z.string().max(2000).nullable().optional(),
      tags: z.array(z.string().max(60)).optional(),
      isDeepDive: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    }),
  ),
});

function readJson(file: string): unknown {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing file: ${path.relative(ROOT, file)}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

const DEMO_COMMITS: Array<{
  subject: string;
  body: string;
  category: CommitCategory;
  rating: number;
  ratingReason: string;
  summaryMd: string;
  tags: string[];
  insertions: number;
  deletions: number;
}> = [
  {
    subject: "feat: add context compaction with token budget hooks",
    body: "Introduce a compaction pipeline that triggers before context overflow and exposes pre/post hooks.",
    category: "feature",
    rating: 4,
    ratingReason: "新增上下文压缩管线与可扩展钩子，覆盖面较大。",
    summaryMd: "示例数据：新增上下文压缩管线，支持触发阈值与钩子扩展。",
    tags: ["context.compaction", "ext.hooks"],
    insertions: 420,
    deletions: 36,
  },
  {
    subject: "perf: cache tool schema serialization",
    body: "Avoid rebuilding tool JSON schemas on every turn.",
    category: "performance",
    rating: 3,
    ratingReason: "减少每轮工具 schema 序列化开销。",
    summaryMd: "示例数据：缓存工具 schema 序列化结果，降低每轮固定开销。",
    tags: ["tools"],
    insertions: 64,
    deletions: 18,
  },
  {
    subject: "fix: quote paths in sandbox allowlist matching",
    body: "Normalize case-insensitive paths before matching workspace rules.",
    category: "bugfix",
    rating: 3,
    ratingReason: "修复沙箱路径匹配的边界问题。",
    summaryMd: "示例数据：修复沙箱 allowlist 的路径归一化问题。",
    tags: ["permissions.sandbox"],
    insertions: 22,
    deletions: 9,
  },
];

function seedDemo(db: ReturnType<typeof getDb>, harnessSlug: string, version: string): void {
  const harness = getHarnessBySlug(db, harnessSlug);
  if (!harness) {
    out(`  ! demo skipped: harness ${harnessSlug} not found`);
    return;
  }

  const day = addDays(toDay(new Date()), -1);
  const timestamp = `${day}T08:00:00.000Z`;
  const commits = DEMO_COMMITS.map((entry, index) => ({
    commit: {
      sha: String(index + 1)
        .repeat(40)
        .slice(0, 40),
      committerDate: timestamp,
      day,
      author: "demo",
      subject: entry.subject,
      body: entry.body,
      filesChanged: 3,
    },
    analysis: entry,
  }));

  const inserted = commits.map((entry) => {
    upsertCommits(db, harness.id, [entry.commit]);
    const row = db
      .prepare("SELECT id FROM commits WHERE harness_id = ? AND sha = ?")
      .get(harness.id, entry.commit.sha) as { id: number } | undefined;
    if (row) {
      updateCommitAnalysis(db, row.id, {
        category: entry.analysis.category,
        rating: entry.analysis.rating,
        ratingReason: entry.analysis.ratingReason,
        summaryMd: entry.analysis.summaryMd,
        featureTags: entry.analysis.tags,
        analyzedBy: "heuristic",
      });
    }
    return row?.id ?? null;
  });

  upsertReleases(db, harness.id, [
    {
      tag: `demo-${version}`,
      name: "Demo release",
      publishedAt: `${day}T00:00:00.000Z`,
      body: "示例发版记录，仅用于演示与 E2E。",
    },
  ]);

  createCandidate(db, {
    harnessId: harness.id,
    commitId: inserted[0],
    moduleKey: "context",
    name: "上下文预算可视化",
    description: "示例候选：在界面中展示上下文 token 预算与压缩历史。",
    evidence: "demo seeding",
    confidence: 0.5,
    createdDay: day,
  });

  out(`  · demo: ${DEMO_COMMITS.length} commits, 1 release, 1 candidate`);
}

function main(): void {
  const demo = process.argv.includes("--demo");
  const db = getDb();

  const taxonomy = taxonomySchema.parse(readJson(TAXONOMY_PATH));
  const baseline = baselineSchema.parse(readJson(BASELINE_PATH));
  const day = baseline.version;

  out(`Seeding baseline ${day}…`);

  for (const entry of baseline.harnesses) {
    const result = createHarness(db, {
      slug: entry.slug,
      name: entry.name,
      repoUrl: entry.repoUrl,
      branch: entry.branch,
      sortOrder: entry.sortOrder,
      enabled: entry.enabled,
      scheduleMode: entry.scheduleMode,
      dailyTime: entry.dailyTime,
      backfillDays: entry.backfillDays,
    });
    out(`  ${result.created ? "+" : "·"} harness ${entry.slug} (${entry.name})`);
  }

  const taxonomyResult = upsertTaxonomy(db, taxonomy);
  out(
    `  · taxonomy: ${taxonomyResult.moduleCount} modules / ${taxonomyResult.featureCount} features ` +
      `(${taxonomyResult.createdFeatures} created)`,
  );

  const harnesses = new Map(
    baseline.harnesses.map((entry) => [entry.slug, getHarnessBySlug(db, entry.slug)]),
  );

  let supports = 0;
  let details = 0;
  for (const feature of baseline.features) {
    const row = getFeatureByKey(db, feature.key);
    if (!row) {
      out(`  ! unknown feature ${feature.key} (not in taxonomy)`);
      continue;
    }

    if (feature.overviewMd !== undefined || feature.diffSummaryMd !== undefined) {
      updateFeatureContent(db, row.id, {
        overviewMd: feature.overviewMd,
        diffSummaryMd: feature.diffSummaryMd,
        updatedDay: day,
      });
    }

    for (const [slug, support] of Object.entries(feature.support)) {
      const harness = harnesses.get(slug);
      if (!harness) {
        out(`  ! feature ${feature.key}: unknown harness ${slug}`);
        continue;
      }
      setFeatureSupport(db, row.id, harness.id, {
        status: support.status,
        notes: support.notes ?? null,
        evidence: support.evidence ?? null,
        sinceVersion: support.sinceVersion ?? null,
        updatedDay: day,
      });
      supports += 1;
    }

    for (const [slug, detail] of Object.entries(feature.details)) {
      const harness = harnesses.get(slug);
      if (!harness) {
        out(`  ! feature ${feature.key}: unknown harness ${slug}`);
        continue;
      }
      upsertFeatureDetail(db, row.id, harness.id, {
        detailMd: detail.detailMd,
        evidence: detail.evidence ?? null,
        updatedDay: day,
      });
      details += 1;
    }
  }

  out(`  · support cells: ${supports}, implementation details: ${details}`);

  if (demo) {
    seedDemo(db, baseline.harnesses[0].slug, day);
  }

  const version = ensureInitialCatalogVersion(
    db,
    baseline.note ?? `初始基线（${day}）`,
    new Date(`${day}T12:00:00.000Z`),
  );
  out(version ? `  + catalog version ${version.version}` : "  · catalog version already exists");

  db.close();
  out("Done. Start with: pnpm dev");
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
