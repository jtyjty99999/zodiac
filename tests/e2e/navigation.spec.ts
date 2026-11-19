import { expect, test } from "@playwright/test";

const SECTIONS = [
  { label: "功能矩阵", path: "/features" },
  { label: "实现对比", path: "/compare" },
  { label: "Harness 管理", path: "/harnesses" },
  { label: "基线版本", path: "/baseline" },
  { label: "设置", path: "/settings" },
];

test("overview loads with harness cards", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "概览", level: 1 })).toBeVisible();
  for (const name of ["Codex", "OpenCode", "Pi", "Wave Agent"]) {
    await expect(page.getByText(name).first()).toBeVisible();
  }
});

for (const section of SECTIONS) {
  test(`sidebar navigates to ${section.label}`, async ({ page }) => {
    await page.goto("/");
    await page.locator("aside nav").getByRole("link", { name: section.label }).click();
    await expect(page).toHaveURL(new RegExp(`${section.path}$`));
    await expect(page.getByRole("heading", { name: section.label, level: 1 })).toBeVisible();
  });
}
