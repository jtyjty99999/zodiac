import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Tests run against throwaway data directories. This must happen before any
 * module imports `DATA_DIR` (vitest runs setup files first).
 */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "zodiac-test-"));
process.env.ZODIAC_DATA_DIR = dataDir;
process.env.ZODIAC_TZ = "UTC";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_MODEL;
delete process.env.GITHUB_TOKEN;
process.env.ZODIAC_SCHEDULER = "off";
