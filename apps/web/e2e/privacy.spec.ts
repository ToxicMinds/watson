// The privacy page (owner approved publishing Watson's Google sign-in app, 28 Oct; Google asks for a
// privacy page on the site, linked from the front page): what Watson keeps, where, and who to ask.
import { expect, test } from "@playwright/test";

test("the front page links the privacy page, which says what Watson keeps and where", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy\/$/);
  await expect(page.getByRole("heading", { name: "Privacy", level: 1 })).toBeVisible();
  for (const heading of ["What Watson keeps", "Where it is kept", "Who sees it", "How long", "Your choices"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  await expect(page.getByText("Frankfurt")).toBeVisible();
  await expect(page.getByText("watson.assists@gmail.com").first()).toBeVisible();
});
