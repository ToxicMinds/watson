// Dates day first (owner, 24 Oct: "dd/mm/yyyy format everywhere in the application and not the American
// way"). The owner's Firefox speaks American English, and drew its own date field month first.
import { expect, signIn, test } from "./account";

test.use({ locale: "en-US" });

test("in an American browser, a consultation's date is typed day/month/year, on a 24-hour clock", async ({ page, account, problems }) => {
  await signIn(page, account);
  await page.getByRole("link", { name: "New consultation" }).first().click();
  const day = page.getByLabel("Date");
  const time = page.getByLabel("Time");
  await expect(day).toHaveValue(/^\d{2}\/\d{2}\/\d{4}$/); // today
  await expect(time).toHaveValue(/^([01]\d|2[0-3]):[0-5]\d$/); // now

  await day.fill("10/27/2026");
  await time.fill("2:30 PM");
  await page.getByRole("button", { name: "Create consultation" }).click();
  await expect(page.getByText("Write the date as day/month/year, like 27/10/2026.")).toBeVisible();
  await expect(page.getByText("Write the time on the 24-hour clock, like 14:30.")).toBeVisible();

  await day.fill("27/10/2026");
  await time.fill("14:30");
  await page.getByRole("button", { name: "Create consultation" }).click();
  await expect(page.getByText("Tue 27 Oct 2026, 14:30")).toBeVisible();
  expect(problems).toEqual([]);
});
