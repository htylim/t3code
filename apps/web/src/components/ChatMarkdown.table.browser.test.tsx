import { act, render as renderScreen } from "../../test/render";

import { expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { getClientSettings, __setClientSettingsForTests } from "../hooks/useSettings";
import ChatMarkdown from "./ChatMarkdown";
let originalSettings: ReturnType<typeof getClientSettings>;

/** Own the rendered tree and fixture cleanup for one test. */
async function createTestSurface() {
  originalSettings = getClientSettings();
  __setClientSettingsForTests({ ...originalSettings, wordWrap: true });
  const container = document.createElement("div");
  container.style.width = "160px";
  document.body.append(container);
  const screen = await renderScreen(null, { container });

  return {
    screen,
    container,
    async [Symbol.asyncDispose]() {
      try {
        __setClientSettingsForTests(originalSettings);
        vi.unstubAllGlobals();
      } finally {
        await screen[Symbol.asyncDispose]();
      }
    },
  };
}

it("hides the wrapping control when no cells are clipped", async () => {
  await using surface = await createTestSurface();
  const { container, screen } = surface;

  await act(async () => {
    screen.rerender(
      <ChatMarkdown cwd={undefined} text={"| Key | Value |\n| --- | --- |\n| A | B |"} />,
    );
  });
  expect(container.querySelector("table")).not.toBeNull();
  expect(container.querySelector('[aria-label="Collapse table cells"]')).toBeNull();
  expect(container.querySelector('[aria-label="Expand table cells"]')).toBeNull();
});

it("keeps long wrapped cells within the chat width while retaining the clipping control", async () => {
  await using surface = await createTestSurface();
  const { container, screen } = surface;

  const longCell = "workspace-name-".repeat(30);
  await act(async () => {
    screen.rerender(
      <ChatMarkdown
        cwd={undefined}
        text={`| Header | Detail |\n| --- | --- |\n| ${longCell} | text |`}
      />,
    );
  });
  const table = container.querySelector("table")!;
  expect(table.getBoundingClientRect().width).toBeLessThanOrEqual(160);
  const collapse = container.querySelector<HTMLButtonElement>(
    '[aria-label="Collapse table cells"]',
  );
  expect(collapse).not.toBeNull();
  await act(async () => collapse!.click());
  expect(container.querySelector('[data-expanded="false"]')).not.toBeNull();
  const expand = container.querySelector<HTMLButtonElement>('[aria-label="Expand table cells"]');
  await act(async () => expand!.click());
  expect(table.getBoundingClientRect().width).toBeLessThanOrEqual(160);
});
