import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { getClientSettings, __setClientSettingsForTests } from "../hooks/useSettings";
import ChatMarkdown from "./ChatMarkdown";

let root: Root;
let container: HTMLDivElement;
let originalSettings: ReturnType<typeof getClientSettings>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  originalSettings = getClientSettings();
  __setClientSettingsForTests({ ...originalSettings, wordWrap: true });
  container = document.createElement("div");
  container.style.width = "160px";
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  __setClientSettingsForTests(originalSettings);
  vi.unstubAllGlobals();
});

it("hides the wrapping control when no cells are clipped", async () => {
  await act(async () => {
    root.render(
      <ChatMarkdown cwd={undefined} text={"| Key | Value |\n| --- | --- |\n| A | B |"} />,
    );
  });
  expect(container.querySelector("table")).not.toBeNull();
  expect(container.querySelector('[aria-label="Collapse table cells"]')).toBeNull();
  expect(container.querySelector('[aria-label="Expand table cells"]')).toBeNull();
});

it("keeps long wrapped cells within the chat width while retaining the clipping control", async () => {
  const longCell = "workspace-name-".repeat(30);
  await act(async () => {
    root.render(
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
