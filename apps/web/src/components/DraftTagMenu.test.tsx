// @vitest-environment jsdom

import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { DraftId } from "../composerDraftStore";
import { makeThreadFixture } from "../test-fixtures";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";

const state = vi.hoisted(() => ({ supported: true, allowed: true, reads: 0 }));
const draftId = "draft-picker-test" as DraftId;
const environmentId = EnvironmentId.make("local");
const threadRef = { environmentId, threadId: ThreadId.make("reserved") };

vi.mock("../composerDraftStore", () => ({
  useComposerDraftStore: (select: (store: { getDraftIdByRef: () => DraftId }) => unknown) =>
    select({ getDraftIdByRef: () => "draft-picker-test" as DraftId }),
}));
vi.mock("../state/entities", () => ({
  useThreadShells: (enabled: boolean) =>
    enabled
      ? [
          makeThreadFixture({
            environmentId: EnvironmentId.make("local"),
            id: ThreadId.make("active"),
          }),
        ]
      : [],
}));
vi.mock("../state/threadTags", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    threadTagEnvironment: {
      supportedAtom: () => Atom.make(state.supported),
      failedAtom: () => Atom.make(false),
      snapshotAtom: () =>
        Atom.make(() => {
          state.reads++;
          return { active: { label: "v3 refactor", color: "#a855f7" } };
        }),
      set: { permissionAtom: () => Atom.make(state.allowed) },
    },
  };
});
vi.mock("./DraftTagTransfers", () => ({ DraftTagTransfers: () => null }));
vi.mock("./chat/composerEventScope", () => ({ useComposerMenuProps: () => ({}) }));

import { DraftTagMenu } from "./DraftTagMenu";
import { useDraftTagStore } from "../draftTagStore";

let root: Root;
let container: HTMLDivElement;

/** Render the real combobox and dialogs against isolated draft and tag snapshots. */
async function mountPicker(): Promise<void> {
  await act(async () =>
    root.render(
      <AppAtomRegistryProvider>
        <DraftTagMenu draftId={draftId} threadRef={threadRef} />
      </AppAtomRegistryProvider>,
    ),
  );
}

/** Activate a real listbox choice by its visible text. */
async function choose(label: string): Promise<void> {
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (node) => node.textContent === label,
  );
  expect(option, `Missing option ${label}`).toBeDefined();
  await act(async () => option!.click());
}

/** Change controlled inputs through the same native input event as a user. */
async function typeInput(input: HTMLInputElement, text: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }),
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.supported = true;
  state.allowed = true;
  state.reads = 0;
  useDraftTagStore.setState({ byDraftId: {}, pendingByThreadKey: {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("shows No Tag, subscribes on opening, selects an existing color, and clears it", async () => {
  await mountPicker();
  expect(container.textContent).toBe("No Tag");
  expect(state.reads).toBe(0);
  await act(async () => container.querySelector("button")!.click());
  expect(state.reads).toBeGreaterThan(0);
  await choose("v3 refactor");
  expect(useDraftTagStore.getState().byDraftId[draftId]).toEqual({
    label: "v3 refactor",
    color: "#a855f7",
  });
  expect(container.textContent).toBe("v3 refactor");
  await act(async () => container.querySelector("button")!.click());
  await choose("Clear tag");
  expect(useDraftTagStore.getState().byDraftId[draftId]).toBeUndefined();
  expect(container.textContent).toBe("No Tag");
});

it("filters choices and opens a label-and-color form for a new tag", async () => {
  await mountPicker();
  await act(async () => container.querySelector("button")!.click());
  await typeInput(
    document.querySelector<HTMLInputElement>('[aria-label="Search tags"]')!,
    "Mobile",
  );
  expect(document.querySelector('[role="option"]')?.textContent).toBe("New tag...");
  await choose("New tag...");
  const labelInput = document.querySelector<HTMLInputElement>('[placeholder="e.g. v3 refactor"]')!;
  expect(labelInput.value).toBe("Mobile");
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Violet tag color"]')!.click(),
  );
  const submit = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Use tag",
  )!;
  await act(async () => submit.click());
  expect(useDraftTagStore.getState().byDraftId[draftId]?.label).toBe("Mobile");
  expect(useDraftTagStore.getState().byDraftId[draftId]?.color).toMatch(/^#[0-9a-f]{6}$/);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it.each(["unsupported", "read-only"])(
  "omits the control on a %s destination",
  async (connection) => {
    state.supported = connection !== "unsupported";
    state.allowed = connection !== "read-only";
    await mountPicker();
    expect(container.querySelector("button")).toBeNull();
    expect(state.reads).toBe(0);
  },
);

it("can clear a selected tag after moving the draft to an unsupported environment", async () => {
  useDraftTagStore.getState().select(draftId, { label: "v3 refactor", color: "#a855f7" });
  state.supported = false;
  await mountPicker();
  await act(async () => container.querySelector("button")!.click());
  expect(
    [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent),
  ).toEqual(["Clear tag"]);
  await choose("Clear tag");
  expect(useDraftTagStore.getState().byDraftId[draftId]).toBeUndefined();
  expect(container.querySelector("button")).toBeNull();
});

it("lets Enter select a searched tag and Escape dismiss the menu", async () => {
  await mountPicker();
  await act(async () => container.querySelector("button")!.click());
  const search = document.querySelector<HTMLInputElement>('[aria-label="Search tags"]')!;
  await act(async () => search.focus());
  await typeInput(search, "REF");
  await act(async () =>
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(useDraftTagStore.getState().byDraftId[draftId]?.label).toBe("v3 refactor");
  await act(async () => container.querySelector("button")!.click());
  const reopenedSearch = document.querySelector<HTMLInputElement>('[aria-label="Search tags"]')!;
  await act(async () =>
    reopenedSearch.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(useDraftTagStore.getState().byDraftId[draftId]?.label).toBe("v3 refactor");
});
