// Watson on one computer (owner, 24 Oct 2026: a colleague runs the whole application locally, on a
// Mac). Payments and Google Calendar need online services, so here they are off unless set up: fees
// are free, and Practice does not offer Google. The engine on this computer does the work.
import { expect, test, type Page } from "@playwright/test";

const login = process.env.LOCAL_LOGIN ?? "doctor";
const password = process.env.LOCAL_PASSWORD ?? "";

async function signIn(page: Page) {
  await page.goto("/sign-in/");
  await page.getByLabel("Name").fill(login);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)$/ })).toBeVisible({ timeout: 30_000 });
}

test("on this computer: no fees, no Google Calendar, and the engine is on", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText("Watson's laptop is on")).toBeVisible({ timeout: 30_000 });
  await page.goto("/consultations/new/");
  await expect(page.getByLabel("Patient's name")).toBeVisible();
  await expect(page.getByLabel("Fee")).toHaveCount(0);
  await page.goto("/calendar/");
  await expect(page.getByRole("heading", { name: "Practice", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Hours patients can book" })).toBeVisible();
  await expect(page.getByLabel("Usual fee")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect Google Calendar" })).toHaveCount(0);
});

test("a call on this computer becomes a transcript and a filled-in form", async ({ page, browser }) => {
  test.setTimeout(20 * 60_000);
  await signIn(page);
  await page.goto("/consultations/new/");
  await page.getByLabel("Patient's name").fill("Jana Nováková");
  await page.getByLabel("Phone or email").fill("jana@example.com");
  await page.getByLabel("Language spoken").selectOption("en");
  await page.getByRole("button", { name: "Create consultation" }).click();
  await expect(page.getByText("The patient opens the link and waits for you to start the call.")).toBeVisible();

  await page.getByRole("link", { name: "Start video call" }).click();
  await page.getByRole("button", { name: "Start video call" }).click();
  const link = await page.getByLabel("Send this link to the patient").inputValue();
  const elsewhere = await browser.newContext({ permissions: ["microphone", "camera"] });
  const patient = await elsewhere.newPage();
  await patient.goto(link);
  await patient.getByRole("button", { name: "Join the call" }).click();
  await expect(patient.getByText("Recorded")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(20_000); // the patient's recorded answer plays as their microphone
  await page.getByRole("button", { name: "End call" }).click();
  await expect(patient.getByText("The consultation has ended.")).toBeVisible();
  await elsewhere.close();

  // The engine on this computer: the transcript, then the form.
  await expect(page.getByRole("heading", { name: "Transcript" })).toBeVisible({ timeout: 10 * 60_000 });
  await expect(page.getByRole("link", { name: /Check the form/ })).toBeVisible({ timeout: 15 * 60_000 });
});
