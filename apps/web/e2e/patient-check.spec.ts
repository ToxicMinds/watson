// "Is this your patient?" (owner, 28 Oct): what a patient types on their link is shown to the practitioner
// at once, and Watson asks before keeping visits together: a new patient with one press, and next time,
// the same person or someone else.
import { expect, test } from "@playwright/test";
import { browserClient, localStack, newPractitioner, PASSWORD, rpc } from "../tests/local-stack";

test("a patient who typed their details is added, and recognised the next time", async ({ page }) => {
  const stack = localStack();
  const eva = await newPractitioner(stack, "check-e2e");
  const phone = `+42190${Date.now().toString().slice(-7)}`;
  const visit = async (name: string) => {
    const made = await rpc(eva.client, "create_consultation", {
      p_scheduled_at: new Date(Date.now() + 86_400_000).toISOString(), p_language: "en", p_consent_recorded: true,
    });
    const { data } = await eva.client.from("consultations").select("invite_token").eq("id", made.consultation_id!).single();
    expect(await rpc(browserClient(stack), "patient_identify", { p_token: data!.invite_token, p_name: name, p_contact: phone }))
      .toEqual({ ok: true });
    return made.consultation_id as string;
  };

  const first = await visit("Jana Nováková");
  await page.goto("/sign-in/");
  await page.getByLabel("Name").fill(eva.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Check who this is")).toBeVisible();

  await page.goto(`/consultation/?id=${first}`);
  await expect(page.getByRole("heading", { name: "Jana Nováková", level: 1 })).toBeVisible();
  const check = page.getByRole("region", { name: "Is this your patient?" });
  await expect(check).toContainText("They are not among your patients yet.");
  await check.getByRole("button", { name: "Add as a new patient" }).click();
  await expect(check).toBeHidden();

  const second = await visit("Jana Novakova");
  await page.goto(`/consultation/?id=${second}`);
  await expect(check).toContainText("You already have Jana Nováková with this phone number. Is it the same person?");
  await check.getByRole("button", { name: "Yes, same person" }).click();
  await expect(check).toBeHidden();
  await expect(page.getByRole("heading", { name: "Jana Nováková", level: 1 })).toBeVisible();
});
