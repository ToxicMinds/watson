// The live transcript beside the call (owner, 24 Oct: "like it happens in Teams", always on). The test
// plays the cloud engine: it reads the pieces the doctor's browser sends and writes their text back.
import { expect, signIn, test } from "./account";
import { localStack, newEngine, rpc } from "../tests/local-stack";

test("during the call, each voice's words appear beside the video", async ({ page, account, browser, problems }) => {
  test.setTimeout(120_000);
  const engine = await newEngine(localStack(), "live-e2e");
  await signIn(page, account);
  await page.getByRole("link", { name: "New consultation" }).first().click();
  await page.getByLabel("Patient's name").fill("Jana Nováková");
  await page.getByLabel("Phone or email").fill(`+421 905 ${Math.floor(Math.random() * 9e5 + 1e5)}`);
  await page.getByRole("button", { name: "Create consultation" }).click();
  await page.getByRole("link", { name: "Start video call" }).click();
  await page.getByRole("button", { name: "Start video call" }).click();
  const link = await page.getByLabel("Send this link to the patient").inputValue();

  const elsewhere = await browser.newContext({ permissions: ["microphone", "camera"] });
  const patient = await elsewhere.newPage();
  await patient.goto(link);
  await patient.getByRole("button", { name: "Join the call" }).click();
  const panel = page.getByRole("complementary", { name: "Live transcript" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Starting Watson's engine")).toBeVisible({ timeout: 30_000 });

  // The engine's part: the first piece of each voice arrives within about ten seconds.
  const heard: Record<string, string> = { patient: "I wake at three every night.", practitioner: "How have you been sleeping?" };
  const done = new Set<string>();
  for (let i = 0; i < 60 && done.size < 2; i++) {
    const piece = (await rpc(engine.client, "engine_claim_live_piece")).piece as { id: string; speaker: string; storage_path: string } | null;
    if (!piece) { await page.waitForTimeout(1000); continue; }
    const ours = !done.has(piece.speaker) && piece.storage_path.includes(new URL(page.url()).searchParams.get("id")!);
    await rpc(engine.client, "engine_live_piece_done", { p_id: piece.id, p_text: ours ? heard[piece.speaker] : "" });
    if (ours) done.add(piece.speaker);
  }
  expect([...done].sort()).toEqual(["patient", "practitioner"]);
  await expect(panel.getByText("I wake at three every night.")).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByText("How have you been sleeping?")).toBeVisible();
  await expect(panel.getByText("Jana Nováková").first()).toBeVisible(); // the patient, by name
  await expect(panel.getByText("You").first()).toBeVisible();

  await page.getByRole("button", { name: "End call" }).click();
  await expect(page.getByRole("heading", { name: /^Transcri(bing|pt)$/ })).toBeVisible({ timeout: 60_000 });
  await elsewhere.close();
  expect(problems).toEqual([]);
});
