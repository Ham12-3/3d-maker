// Records the README demo: types two commands into a running Speakworld
// (real Claude, so it needs ANTHROPIC_API_KEY on the server) and saves the
// browser video. Convert with ffmpeg afterwards (see README "Demo GIF").
//
//   node scripts/record-demo.mjs http://localhost:3002 out-dir

import { chromium } from "@playwright/test";

const [base = "http://localhost:3000", outDir = "demo-video"] = process.argv.slice(2);
const size = { width: 1280, height: 720 };

const browser = await chromium.launch({
  // New headless mode with the GPU, so the 3D view renders at full speed.
  channel: "chromium",
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({
  viewport: size,
  deviceScaleFactor: 1,
  recordVideo: { dir: outDir, size },
});
const page = await context.newPage();
await page.goto(base);
await page.locator("[data-stage-frame] canvas").waitFor();
await page.waitForTimeout(4000);

const command = page.getByRole("textbox", { name: "Command" });
for (const text of [
  "remove the shapes and build a cosy village by a lake at sunset",
  "slowly fly over the village",
]) {
  await command.click();
  await command.pressSequentially(text, { delay: 25 });
  await command.press("Enter");
  // The mic button is disabled while the agent works: wait for the turn to
  // start and finish, then let the scene settle.
  const mic = page.getByRole("button", { name: "Hold to talk" });
  await mic.isDisabled({ timeout: 5000 }).catch(() => {});
  await page.waitForFunction(
    () => !document.querySelector('button[aria-label="Hold to talk"]')?.disabled,
    undefined,
    { timeout: 90_000, polling: 250 },
  );
  // A camera move keeps playing after the turn ends: let it finish.
  await page.waitForTimeout(text.includes("fly") ? 15_000 : 3000);
}

const video = page.video();
await context.close();
console.log(await video?.path());
await browser.close();
