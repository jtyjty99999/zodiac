import { describe, expect, test } from "vitest";
import { ensureSha, parseLog, parseNumstat } from "@/lib/git/log";

const RECORD = "\u001e";
const FIELD = "\u0000";

function segment(
  sha: string,
  date: string,
  author: string,
  subject: string,
  body: string,
  files: string,
) {
  return `${RECORD}${sha}${FIELD}${date}${FIELD}${author}${FIELD}${subject}${FIELD}${body}${FIELD}\n${files}`;
}

describe("parseLog", () => {
  test("parses commits with files", () => {
    const sha = "a".repeat(40);
    const raw = segment(
      sha,
      "2026-11-19T01:02:03+08:00",
      "Alice",
      "Add MCP transport",
      "Body line one\nBody line two",
      "A\tsrc/mcp.ts\nM\tsrc/index.ts\nD\told.ts",
    );

    const commits = parseLog(raw);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual({
      sha,
      committerDate: "2026-11-18T17:02:03.000Z",
      author: "Alice",
      subject: "Add MCP transport",
      body: "Body line one\nBody line two",
      files: [
        { status: "A", path: "src/mcp.ts" },
        { status: "M", path: "src/index.ts" },
        { status: "D", path: "old.ts" },
      ],
    });
  });

  test("parses multiple commits and skips invalid records", () => {
    const raw =
      "garbage without a sha" +
      segment("b".repeat(40), "2026-11-18T00:00:00Z", "", "subject one", "", "") +
      segment("c".repeat(40), "not a date", "Bob", "subject two", "body", "R100\tnew.ts\told.ts");
    const commits = parseLog(raw);
    expect(commits).toHaveLength(2);
    expect(commits[0].sha).toBe("b".repeat(40));
    expect(commits[0].author).toBe("unknown");
    expect(commits[0].subject).toBe("subject one");
    // Invalid dates normalise to the epoch rather than failing the whole parse.
    expect(commits[1].committerDate).toBe("1970-01-01T00:00:00.000Z");
    expect(commits[1].files).toEqual([{ status: "R100", path: "new.ts\told.ts" }]);
  });

  test("strips control characters and caps field lengths", () => {
    const raw = segment(
      "d".repeat(40),
      "2026-11-18T00:00:00Z",
      "A\u0007lice",
      `Bad\u0007subject ${"x".repeat(600)}`,
      "y".repeat(9000),
      "",
    );
    const [commit] = parseLog(raw);
    expect(commit.author).toBe("Alice");
    expect(commit.subject).not.toContain("\u0007");
    expect(commit.subject.length).toBe(500);
    expect(commit.body.length).toBe(8000);
  });

  test("ignores file lines without a tab", () => {
    const raw = segment(
      "e".repeat(40),
      "2026-11-18T00:00:00Z",
      "A",
      "s",
      "",
      "no-tab-here\nM\tok.ts",
    );
    expect(parseLog(raw)[0].files).toEqual([{ status: "M", path: "ok.ts" }]);
  });

  test("returns an empty list for blank input", () => {
    expect(parseLog("")).toEqual([]);
    expect(parseLog("\n\n")).toEqual([]);
  });
});

describe("parseNumstat", () => {
  test("sums insertions and deletions", () => {
    const result = parseNumstat("10\t2\tsrc/a.ts\n-\t-\timage.png\n3\t0\tsrc/b.ts\n");
    expect(result.insertions).toBe(13);
    expect(result.deletions).toBe(2);
    expect(result.files).toEqual([
      { path: "src/a.ts", additions: 10, deletions: 2 },
      { path: "image.png", additions: 0, deletions: 0 },
      { path: "src/b.ts", additions: 3, deletions: 0 },
    ]);
  });

  test("keeps tabs inside paths", () => {
    const result = parseNumstat("1\t1\tdir/with\ttab.ts\n");
    expect(result.files[0].path).toBe("dir/with\ttab.ts");
  });

  test("ignores malformed lines and clamps negatives", () => {
    const result = parseNumstat("\n\t\t\n-5\t-2\tsrc/x.ts\n");
    expect(result.files).toEqual([{ path: "src/x.ts", additions: 0, deletions: 0 }]);
  });
});

describe("ensureSha", () => {
  test("accepts short and full SHAs and lowercases them", () => {
    expect(ensureSha("ABC1234")).toBe("abc1234");
    expect(ensureSha("a".repeat(40))).toBe("a".repeat(40));
  });

  test("rejects ref injection and non-hex values", () => {
    expect(() => ensureSha("HEAD")).toThrow(/Invalid commit SHA/);
    expect(() => ensureSha("--all")).toThrow(/Invalid commit SHA/);
    expect(() => ensureSha("xyz")).toThrow(/Invalid commit SHA/);
  });
});
