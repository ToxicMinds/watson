import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// Local runs serve the static build. Set E2E_BASE_URL (with E2E_EMAIL and
// E2E_PASSWORD) to run the same checks against the deployed app.
const remote = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: remote ?? "http://127.0.0.1:3210", trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      testIgnore: /firefox/,
      use: {
        ...devices["Desktop Chrome"],
        // A synthetic microphone, so recording can be tested without a person.
        // The speech fixture plays as the microphone; the camera is a test pattern.
        permissions: ["microphone", "camera"],
        launchOptions: {
          args: [
            // Silent: the calls in these tests must not play through the computer's speakers (the
            // owner heard them as a loud beep, 24 Oct). The fake microphone still feeds the call.
            "--mute-audio",
            "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
            `--use-file-for-fake-audio-capture=${fileURLToPath(new URL("../../packages/test-fixtures/audio/en-patient-sleep.wav", import.meta.url))}`,
          ],
        },
      },
    },
    {
      // The call in Firefox, which records Ogg and labels it differently (owner's test of 24 Oct).
      name: "firefox",
      testMatch: /firefox/,
      use: {
        ...devices["Desktop Firefox"],
        launchOptions: {
          // media.volume_scale 0: silent, as Chrome's --mute-audio above.
          firefoxUserPrefs: { "media.navigator.streams.fake": true, "media.navigator.permission.disabled": true, "media.volume_scale": "0.0" },
        },
      },
    },
  ],
  webServer: remote
    ? undefined
    : { command: "pnpm exec serve out -l 3210 -L", url: "http://127.0.0.1:3210/sign-in/", reuseExistingServer: false },
});
