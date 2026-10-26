// The front page is Watson's shop window (owner, 16 Oct): search engines and link previews read
// what it is, and until launch it asks them not to list it (sample practitioners, no own domain yet).
import { expect, signIn, test } from "./account";
import { SITE_URL as SITE } from "../src/lib/site";
import { localStack, newPractitioner, rpc } from "../tests/local-stack";

test("the front page tells search engines and link previews what Watson is, and asks them to wait for launch", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Watson · Ayurveda and integrative care by video");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /practitioner.*video/i);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${SITE}/`);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Watson/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Allow: /book/");
  for (const path of ["/consultations/", "/consultation/", "/calendar/", "/form/", "/room/", "/join/", "/j/", "/sign-in/"]) {
    expect(robots).toContain(`Disallow: ${path}`);
  }
  expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  expect(await (await request.get("/sitemap.xml")).text()).toContain(`<loc>${SITE}/</loc>`);
});

test("with nobody taking bookings yet, the front page says so rather than blaming the language", async ({ page, problems }) => {
  await page.route("**/rest/v1/rpc/find_practitioners", (route) => route.fulfill({ json: { ok: true, practitioners: [] } }));
  await page.goto("/");
  await expect(page.getByText("No practitioners are taking bookings yet")).toBeVisible();
  await expect(page.getByText("Try another language")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("a practitioner's booking page carries their name in the browser tab and in search results", async ({ page }) => {
  const who = await newPractitioner(localStack(), "title");
  const saved = await rpc(who.client, "save_booking_page", {
    p_display_name: "Dr. Tab Title", p_offer: "Ayurveda", p_about: "", p_languages: ["en"],
    p_hours: { "1": ["09:00", "12:00"] }, p_length_minutes: 45, p_gap_minutes: 15, p_fee_cents: null,
  });
  await page.goto(`/book/?p=${saved.slug}`);
  await expect(page).toHaveTitle("Dr. Tab Title · Watson");
});

test("a direct booking link with no saved hours shows no dates or times", async ({ page }) => {
  const who = await newPractitioner(localStack(), "closed-booking-page");
  const saved = await rpc(who.client, "save_booking_page", {
    p_display_name: "Dr. Closed Schedule", p_offer: "", p_about: "", p_languages: ["en"],
    p_hours: {}, p_length_minutes: 45, p_gap_minutes: 15, p_fee_cents: null,
  });

  await page.goto(`/book/?p=${saved.slug}`);
  await expect(page.getByRole("heading", { name: "Dr. Closed Schedule", level: 1 })).toBeVisible();
  await expect(page.getByText("No free times in the next 4 weeks.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Days" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: /Times on/ })).toHaveCount(0);
});

test("pages load without anything refused by the security policy (Chrome shows each refusal as an error)", async ({ page, account }) => {
  const refused: string[] = [];
  await page.exposeFunction("reportRefused", (what: string) => refused.push(what));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) =>
    (window as unknown as { reportRefused: (what: string) => void }).reportRefused(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}`)));
  for (const path of ["/", "/book/?p=nobody"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  await signIn(page, account);
  await page.goto("/consultations/new/");
  await page.waitForLoadState("networkidle");
  expect(refused).toEqual([]);
});
