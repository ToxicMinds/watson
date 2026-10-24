// Withdrawing consent (owner's test of 24 Oct: on an approved consultation the button failed with
// "That is not possible at this stage"). The spec, section 15: withdrawal is offered until a record
// is approved; what must be kept after that is a question for the real-patient gate.
import { expect, signIn, test } from "./account";
import { localStack, rpc, sqlAsOwner } from "../tests/local-stack";
import { createClient } from "@supabase/supabase-js";

async function consultationIn(account: { email: string; password: string }, status: string) {
  const stack = localStack();
  const client = createClient(stack.url, stack.publishableKey, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email: account.email, password: account.password });
  const made = await rpc(client as never, "create_consultation", { p_scheduled_at: "2026-10-22T09:00:00Z", p_language: "en", p_consent_recorded: true });
  sqlAsOwner(`update public.consultations set status = '${status}' where id = '${made.consultation_id}';`);
  return made.consultation_id!;
}

test("consent can be withdrawn until the form is approved, and the page says why not after", async ({ page, account, problems }) => {
  const draft = await consultationIn(account, "draft_ready");
  const approved = await consultationIn(account, "approved");
  await signIn(page, account);

  await page.goto(`/consultation/?id=${draft}`);
  await expect(page.getByRole("button", { name: "Withdraw consent" })).toBeVisible();

  await page.goto(`/consultation/?id=${approved}`);
  await expect(page.getByText("The form is approved, so consent can no longer be withdrawn here.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Withdraw consent" })).toHaveCount(0);
  expect(problems).toEqual([]);
});
