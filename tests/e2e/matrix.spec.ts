import { expect, test } from "@playwright/test";

test("matrix lists every feature and links into the compare view", async ({ page }) => {
  await page.goto("/features");
  await expect(page.getByRole("heading", { name: "功能矩阵", level: 1 })).toBeVisible();
  // 85 features across 13 modules in the seeded baseline.
  await expect(page.getByText("85", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "智能体循环" })).toBeVisible();

  await page.getByRole("link", { name: "工具调用主循环" }).click();
  await expect(page).toHaveURL(/\/compare\/agent-loop\.tool-call-loop$/);
  await expect(page.getByRole("heading", { name: "工具调用主循环", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "横向差异" })).toBeVisible();
  for (const name of ["Codex", "OpenCode", "Pi", "Wave Agent"]) {
    await expect(
      page.locator("section.card").getByText(name, { exact: true }).first(),
    ).toBeVisible();
  }
});

test("search filters the matrix by feature text", async ({ page }) => {
  await page.goto("/features");
  await page.locator("#q").fill("compaction");
  await page.getByRole("button", { name: "筛选" }).click();

  await expect(page).toHaveURL(/\/features\?.*q=compaction/);
  await expect(page.getByRole("link", { name: "自动压缩" })).toBeVisible();
  await expect(page.getByRole("link", { name: "流式响应循环" })).toHaveCount(0);
});

test("compare index exposes deep dives by module", async ({ page }) => {
  await page.goto("/compare");
  await expect(page.getByRole("heading", { name: "实现对比", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /子智能体/ }).first()).toBeVisible();
});
