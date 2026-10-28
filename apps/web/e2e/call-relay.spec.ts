// A call that can only go through Watson's relay (owner, 28 Oct: a call from a phone on 5G never
// connected). Both browsers are told to use relay addresses only, which is what a phone behind its
// carrier's shared address ends up needing. Needs the `ice` function with Watson's Cloudflare TURN key,
// so it runs on request: E2E_RELAY=1 (locally with `supabase functions serve`, or with E2E_BASE_URL).
import type { Page } from "@playwright/test";
import { expect, signIn, test } from "./account";

test.skip(!process.env.E2E_RELAY, "set E2E_RELAY=1 where the ice function has Watson's TURN key");

/** Every connection the page makes may use relay addresses only, and is kept for the test to inspect. */
async function relayOnly(page: Page) {
  await page.addInitScript(() => {
    const Native = window.RTCPeerConnection;
    const peers: RTCPeerConnection[] = [];
    (window as unknown as { peers: RTCPeerConnection[] }).peers = peers;
    window.RTCPeerConnection = class extends Native {
      constructor(configuration?: RTCConfiguration) {
        super({ ...configuration, iceTransportPolicy: "relay" });
        peers.push(this);
      }
    } as typeof RTCPeerConnection;
  });
}

/** The kind of local address the page's live connection uses: "relay" when the call goes through TURN. */
const route = (page: Page) => page.evaluate(async () => {
  const peers = (window as unknown as { peers: RTCPeerConnection[] }).peers;
  const live = peers.filter((peer) => peer.connectionState === "connected").at(-1);
  if (!live) return null;
  const stats = [...(await live.getStats()).values()];
  const pairId = stats.find((s) => s.type === "transport")?.selectedCandidatePairId;
  const pair = stats.find((s) => s.id === pairId);
  return stats.find((s) => s.id === pair?.localCandidateId)?.candidateType ?? null;
});

test("a call connects through the relay when the browsers cannot reach each other directly", async ({ page, account, browser }) => {
  test.setTimeout(120_000);
  await relayOnly(page);
  await signIn(page, account);
  await page.getByRole("link", { name: "New consultation" }).first().click();
  await page.getByLabel("Language spoken").selectOption("en");
  await page.getByRole("button", { name: "Create consultation" }).click();
  await page.getByRole("link", { name: "Start video call" }).click();
  await page.getByRole("button", { name: "Start video call" }).click();
  await expect(page.getByText("Waiting for the patient")).toBeVisible();
  const link = await page.getByLabel("Send this link to the patient").inputValue();

  const elsewhere = await browser.newContext({ permissions: ["microphone", "camera"] });
  const patient = await elsewhere.newPage();
  await relayOnly(patient);
  await patient.goto(link);
  await patient.getByRole("button", { name: "Join the call" }).click();
  await expect(patient.getByText("Recorded")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/^Recording \d+:\d\d$/)).toBeVisible();
  expect(await route(page)).toBe("relay");
  expect(await route(patient)).toBe("relay");
  await elsewhere.close();
});
