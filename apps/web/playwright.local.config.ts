import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// Checks Watson running on this computer (scripts/local.sh start), not the test build: run it with
// scripts/local.sh check. It signs in as the local doctor that scripts/local.sh setup made.
export default defineConfig({
  testDir: "e2e-local",
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.LOCAL_URL ?? "http://localhost:3000",
    permissions: ["microphone", "camera"],
    launchOptions: {
      args: [
        "--mute-audio", // the test call must not play through the speakers
        "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${fileURLToPath(new URL("../../packages/test-fixtures/audio/en-patient-sleep.wav", import.meta.url))}`,
      ],
    },
  },
});
