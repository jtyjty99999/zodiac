import { expect, test } from "@playwright/test";

test("explore page offers a proposition form and harness selection", async ({ page }) => {
  await page.goto("/explore");
  await expect(page.getByRole("heading", { name: "功能探索", level: 1 })).toBeVisible();

  const proposition = page.locator("#exploration-proposition");
  await expect(proposition).toBeVisible();
  await expect(proposition).toHaveAttribute("maxlength", "600");

  const submit = page.getByRole("button", { name: "开始探索" });
  await expect(submit).toBeDisabled();

  const harnessChecks = page.locator('input[type="checkbox"]');
  await expect(harnessChecks.first()).toBeChecked();

  await proposition.fill("如何处理上下文压缩");
  await expect(submit).toBeEnabled();

  // Short propositions stay blocked.
  await proposition.fill("上");
  await expect(submit).toBeDisabled();
});
