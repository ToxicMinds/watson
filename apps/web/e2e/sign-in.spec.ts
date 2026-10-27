import { expect, test } from "./account";

test("a visitor who is not signed in is sent to sign-in", async ({ page, problems }) => {
  await page.goto("/consultations/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("link", { name: /sign up|register|create account/i })).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("a wrong password is refused with a clear message", async ({ page, account }) => {
  await page.goto("/sign-in/");
  await page.getByLabel("Name").fill(account.email);
  await page.getByLabel("Password").fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("region", { name: "Sign in" }).getByRole("alert")).toContainText("That name and password do not match an account.");
  await expect(page).toHaveURL(/\/sign-in\/$/);
});

test("empty fields are explained before anything is sent", async ({ page }) => {
  await page.goto("/sign-in/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Enter your name.")).toBeVisible();
  await expect(page.getByText("Enter your password.")).toBeVisible();
});

test("sign-in remains usable at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/sign-in/");
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    button: document.querySelector(".wa-door__card button")?.getBoundingClientRect().toJSON(),
    card: document.querySelector(".wa-door__card")?.getBoundingClientRect().toJSON(),
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.button?.height).toBeGreaterThanOrEqual(44);
  expect(dimensions.button?.width).toBeCloseTo(dimensions.card!.width - 34, 0);
});

test("patient can request an eight-digit email code on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  let requested: Record<string, unknown> | undefined;
  await page.route("**/auth/v1/otp**", async (route) => {
    requested = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/patient/sign-in/");
  await expect(page.getByRole("heading", { name: "Patient sign-in" })).toBeVisible();
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  expect(requested).toBeUndefined();

  await page.getByLabel("Email address").fill("patient@example.test");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByLabel("Eight-digit code")).toBeVisible();
  expect(requested).toMatchObject({ email: "patient@example.test", create_user: true });

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    buttonHeights: [...document.querySelectorAll<HTMLButtonElement>(".wa-door__card button")]
      .filter((button) => button.offsetParent !== null)
      .map((button) => button.getBoundingClientRect().height),
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.buttonHeights.every((height) => height >= 44)).toBe(true);
});

test("a patient verifies a real local email code and receives the patient session", async ({ page, problems }) => {
  test.skip(Boolean(process.env.E2E_BASE_URL), "Uses the local Mailpit sink, never a real email provider");
  const email = `patient-e2e-${crypto.randomUUID()}@watson.test`;
  await page.goto("/patient/sign-in/");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByLabel("Eight-digit code")).toBeVisible();

  let message: { ID: string } | undefined;
  await expect.poll(async () => {
    const response = await fetch("http://127.0.0.1:54324/api/v1/messages");
    const inbox = await response.json() as { messages: { ID: string; To: { Address: string }[] }[] };
    message = inbox.messages.find((item) => item.To.some((recipient) => recipient.Address === email));
    return message?.ID ?? null;
  }).not.toBeNull();

  const response = await fetch(`http://127.0.0.1:54324/api/v1/message/${message!.ID}`);
  const delivery = await response.json() as { Subject: string; Text: string };
  expect(delivery.Subject).toBe("Your Watson sign-in code");
  const code = delivery.Text.match(/(?:^|\n)(\d{8})(?:\n|$)/)?.[1];
  expect(code).toMatch(/^\d{8}$/);

  await page.getByLabel("Eight-digit code").fill(code!);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page).toHaveURL(/\/patient\/$/);
  await expect(page.getByRole("heading", { name: "You’re signed in" })).toBeVisible();
  await expect(page.getByText(`Verified email: ${email}`)).toBeVisible();
  expect(problems).toEqual([]);
});

test("a practitioner signs in, sees their consultations, and signs out", async ({ page, account, problems }) => {
  await page.goto("/sign-in/"); // the front page is for patients (owner, 16 Oct, E)
  await page.getByLabel("Name").fill(account.email.replace(/@watson\.test$/, ""));
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)$/ })).toBeVisible();
  await expect(page.getByText(`Signed in as ${account.email.replace(/@watson\.test$/, "")}`)).toBeVisible();
  if (account.references.length > 0) {
    await expect(page.getByRole("link", { name: /SYN-0043/ })).toContainText("Slovak");
    await expect(page.getByRole("link", { name: /SYN-0043/ })).toContainText("Waiting for consent");
    await expect(page.getByRole("link", { name: /SYN-0042/ })).toContainText("Waiting for the call");
  }

  // The session survives a reload, and ends on sign-out.
  await page.reload();
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)$/ })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.goto("/consultations/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(problems).toEqual([]);
});

test("the front page is for patients: practitioners to choose from, and a way in for practitioners", async ({ page, problems }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Find a practitioner" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Patient sign-in" })).toHaveAttribute("href", "/patient/sign-in/");
  await page.getByRole("link", { name: "Practitioner sign-in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(problems).toEqual([]);
});
