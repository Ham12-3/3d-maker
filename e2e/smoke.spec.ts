import { expect, test, type Page } from "@playwright/test";
import { fakeAgentEvents } from "../src/agent/fake-stream";

/**
 * Smoke test: the app loads and renders, a typed command runs through the
 * real agent loop (Claude mocked), undo works, a share link opens the world,
 * and Director frames the view as a reel.
 */

async function mockAgent(page: Page) {
  await page.route("**/api/agent", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: fakeAgentEvents(
        [
          {
            tool: "set_environment",
            input: { timeOfDay: 22, sky: "night", stars: true, fog: { color: "#0b1430" } },
          },
          { tool: "say", input: { text: "Night has fallen." } },
        ],
        "tool_use",
        "claude-haiku-5-5",
      ),
    }),
  );
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

test("build by command, undo, share, open the link, direct", async ({ page, context }) => {
  const errors = collectErrors(page);
  await mockAgent(page);
  await page.goto("/");

  // The 3D view mounts and draws.
  const canvas = page.locator("[data-stage-frame] canvas");
  await expect(canvas).toBeVisible();

  // A typed command runs the agent loop and becomes one undo step.
  const command = page.getByRole("textbox", { name: "Command" });
  await command.fill("make it night");
  await command.press("Enter");
  await expect(page.getByText("Night has fallen.")).toBeVisible();
  const undo = page.getByRole("button", { name: 'Undo "make it night"' });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(page.getByRole("button", { name: 'Redo "make it night"' })).toBeEnabled();

  // Share as on a deployment without a database: the world goes in the link.
  await page.route("**/api/worlds", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { available: false } })
      : route.fallback(),
  );
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Create share link" }).click();
  const link = page.locator("input[readonly]");
  await expect(link).toHaveValue(/\/v#world=[\w-]+$/);
  const url = await link.inputValue();
  const viewer = await context.newPage();
  const viewerErrors = collectErrors(viewer);
  await viewer.goto(url);
  await expect(viewer.getByRole("link", { name: "Remix" })).toBeVisible();
  await expect(viewer.locator("[data-stage-frame] canvas")).toBeVisible();
  await expect(viewer.getByText("Untitled world")).toBeVisible();
  // Remix opens the packed world in the editor (and tidies the URL).
  await viewer.getByRole("link", { name: "Remix" }).click();
  await expect(viewer.getByRole("textbox", { name: "Command" })).toBeVisible();
  await expect(viewer).toHaveURL(/\/$/);
  await viewer.close();

  // Director frames the view 9:16.
  await page.getByRole("button", { name: "Director", exact: true }).click();
  await expect(page.getByRole("button", { name: "Record" })).toBeVisible();
  await expect
    .poll(async () => {
      const box = await page.locator("[data-stage-frame]").boundingBox();
      return box ? +(box.width / box.height).toFixed(2) : 0;
    })
    .toBeCloseTo(9 / 16, 1);

  expect(errors, errors.join("\n")).toEqual([]);
  expect(viewerErrors, viewerErrors.join("\n")).toEqual([]);
});
