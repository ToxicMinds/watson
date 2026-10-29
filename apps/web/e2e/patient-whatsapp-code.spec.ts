// A patient picks WhatsApp for their sign-in code (owner, 24 and 28 Oct: email or WhatsApp, never forced).
import { expect, test } from "@playwright/test";

test("a patient asks for their sign-in code on WhatsApp", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  let requested: Record<string, unknown> | undefined;
  await page.route("**/functions/v1/patient-otp", async (route) => {
    requested = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/patient/sign-in/");
  await page.getByRole("radio", { name: "WhatsApp" }).click();
  await page.getByLabel("WhatsApp number").fill("0905 111 222");
  await page.getByRole("button", { name: "Send me a code on WhatsApp" }).click();
  await expect(page.getByText("Enter your WhatsApp number with its country code")).toBeVisible();
  expect(requested).toBeUndefined();

  await page.getByLabel("WhatsApp number").fill("+421 905 111 222");
  await page.getByRole("button", { name: "Send me a code on WhatsApp" }).click();
  await expect(page.getByLabel("Eight-digit code")).toBeVisible();
  await expect(page.getByText("A code is on its way to +421905111222 on WhatsApp.")).toBeVisible();
  expect(requested).toEqual({ action: "send", phone: "+421905111222" });
});
