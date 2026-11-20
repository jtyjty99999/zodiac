import { expect, test } from "@playwright/test";

test("settings shows analysis, routing and timezone controls", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "设置", level: 1 })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /启用 Claude 增强分析/ })).toBeVisible();
  await expect(page.locator("#settings-ai-model")).toBeVisible();
  await expect(page.locator("#settings-timezone")).toHaveValue("Asia/Shanghai");
  // The engine choice is persisted user state, so assert the control exposes
  // exactly the supported engines rather than one particular stored value.
  await expect(page.locator("#settings-explore-engine")).toHaveValue(
    /^(api|claude-code|codex|deepseek)$/,
  );
  await expect(page.locator("#settings-claude-code-command")).not.toHaveValue("");
  await expect(page.locator("#settings-codex-command")).not.toHaveValue("");
  await expect(page.locator("#settings-deepseek-command")).not.toHaveValue("");
  await expect(page.getByRole("button", { name: "保存设置" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "环境变量" })).toBeVisible();
});

test("baseline page offers JSON and Markdown exports", async ({ page, request }) => {
  await page.goto("/baseline");
  await expect(page.getByRole("heading", { name: "基线版本", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /导出 Markdown/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /导出 JSON/ })).toBeVisible();

  const markdown = await request.get("/api/baseline/export?format=md");
  expect(markdown.status()).toBe(200);
  expect(markdown.headers()["content-type"]).toContain("text/markdown");
  expect(await markdown.text()).toContain("| 功能点 | 说明 | Codex | OpenCode | Pi | Wave Agent |");
});
