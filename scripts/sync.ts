import { getDb } from "../src/lib/db/client";
import { getHarnessBySlug, listHarnesses } from "../src/lib/db/repositories/harnesses";
import { syncHarness } from "../src/lib/ingest/sync";

function usage(): never {
  process.stderr.write("Usage: pnpm sync [--harness <slug>] [--all] [--no-analyze]\n");
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const analyze = !args.includes("--no-analyze");
  const all = args.includes("--all");
  const harnessIndex = args.indexOf("--harness");
  const slug = harnessIndex >= 0 ? args[harnessIndex + 1] : undefined;

  if (!all && !slug) usage();

  const db = getDb();
  const targets = all
    ? listHarnesses(db, { enabledOnly: true })
    : (() => {
        const harness = getHarnessBySlug(db, slug as string);
        if (!harness) {
          process.stderr.write(`Unknown harness: ${slug}\n`);
          process.exit(1);
        }
        return [harness];
      })();

  if (targets.length === 0) {
    process.stderr.write("No enabled harnesses to sync.\n");
    process.exit(1);
  }

  let failed = 0;
  for (const harness of targets) {
    process.stdout.write(`Syncing ${harness.slug}…\n`);
    try {
      const report = await syncHarness(db, harness.id, { trigger: "cli", analyze });
      process.stdout.write(
        `  ${report.status}: +${report.newCommits} commits, +${report.newReleases} releases, ` +
          `${report.analyzed} analyzed (${report.aiUsed} with AI)\n`,
      );
      if (report.error) process.stderr.write(`  error: ${report.error}\n`);
      if (report.status === "failed") failed += 1;
    } catch (error) {
      failed += 1;
      process.stderr.write(`  failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  db.close();
  if (failed > 0) process.exit(1);
}

void main();
