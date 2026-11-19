import { expect, test } from "@playwright/test";

test("harness manager lists the tracked harnesses and exposes the add form", async ({ page }) => {
  await page.goto("/harnesses");
  await expect(page.getByRole("heading", { name: "Harness 管理", level: 1 })).toBeVisible();

  for (const name of ["Codex", "OpenCode", "Pi", "Wave Agent"]) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }

  await expect(page.getByRole("heading", { name: "添加 Harness" })).toBeVisible();
  await expect(page.locator("#harness-new-slug")).toBeVisible();
  await expect(page.locator("#harness-new-repo")).toBeVisible();
});

test("harness card opens the edit form with schedule fields", async ({ page }) => {
  await page.goto("/harnesses");
  await page.getByText("编辑配置").first().click();

  await expect(page.getByRole("button", { name: "保存配置" }).first()).toBeVisible();
  await expect(page.locator("input[type=time]").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "同步" }).first()).toBeVisible();
});
