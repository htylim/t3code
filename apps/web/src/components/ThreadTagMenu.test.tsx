// @vitest-environment jsdom

import { EnvironmentId, ThreadId, type ThreadTags } from "@t3tools/contracts";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { DraftId } from "../composerDraftStore";
import { makeThreadFixture } from "../test-fixtures";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";

const state = vi.hoisted(() => ({
  supported: true,
  allowed: true,
  reads: 0,
  draft: true,
  snapshot: { active: { label: "v3 refactor", color: "#a855f7" } } as ThreadTags | null,
  save: vi.fn(),
}));
const draftId = "draft-picker-test" as DraftId;
const environmentId = EnvironmentId.make("local");
const threadRef = { environmentId, threadId: ThreadId.make("reserved") };

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
          return state.snapshot;
        }),
      set: { permissionAtom: () => Atom.make(state.allowed) },
    },
  };
});
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => state.save }));
vi.mock("./DraftTagTransfers", () => ({ DraftTagTransfers: () => null }));
vi.mock("./chat/composerEventScope", () => ({ useComposerMenuProps: () => ({}) }));

import { ThreadTagMenu } from "./ThreadTagMenu";
import { useDraftTagStore } from "../draftTagStore";

let root: Root;
let container: HTMLDivElement;

/** Render the real combobox and dialogs against isolated draft and tag snapshots. */
async function mountPicker(): Promise<void> {
  await act(async () =>
    root.render(
      <AppAtomRegistryProvider>
        <ThreadTagMenu draftId={state.draft ? draftId : undefined} threadRef={threadRef} />
      </AppAtomRegistryProvider>,
    ),
  );
}

/** Activate a real listbox choice by its visible text. */
async function choose(label: string): Promise<void> {
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (node) => (node.querySelector("[data-tag-label]")?.textContent ?? node.textContent) === label,
  );
  expect(option, `Missing option ${label}`).toBeDefined();
  await act(async () => option!.click());
}

/** Ensure nested actions can receive browser mouse events before activating their menu. */
async function clickRowAction(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    const pointerDown = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    button.dispatchEvent(pointerDown);
    expect(pointerDown.defaultPrevented).toBe(false);
    button.click();
  });
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
  state.draft = true;
  state.snapshot = { active: { label: "v3 refactor", color: "#a855f7" } };
  state.save.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
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

it.each(["untagged", "tagged"])(
  "creates a searched label with the default color when Enter confirms no matches for a %s draft",
  async (tagState) => {
    if (tagState === "tagged")
      useDraftTagStore.getState().select(draftId, { label: "Previous tag", color: "#abcdef" });
    await mountPicker();
    await act(async () => container.querySelector("button")!.click());
    const search = document.querySelector<HTMLInputElement>('[aria-label="Search tags"]')!;
    await act(async () => search.focus());
    await typeInput(search, "  Mobile  ");
    expect(document.querySelector('[role="option"]')?.textContent).toBe('Create new tag "Mobile"');
    await act(async () =>
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(useDraftTagStore.getState().byDraftId[draftId]).toEqual({
      label: "Mobile",
      color: null,
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    await act(async () => container.querySelector("button")!.click());
    expect(document.querySelector("[data-tag-label]")?.textContent).toBe("Mobile");
  },
);

it("creates a missing tag by clicking its search result", async () => {
  await mountPicker();
  await act(async () => container.querySelector("button")!.click());
  await typeInput(
    document.querySelector<HTMLInputElement>('[aria-label="Search tags"]')!,
    "Mobile",
  );
  await choose('Create new tag "Mobile"');
  expect(useDraftTagStore.getState().byDraftId[draftId]).toEqual({ label: "Mobile", color: null });
});

it("does not offer creation for blank searches or matching labels", async () => {
  await mountPicker();
  await act(async () => container.querySelector("button")!.click());
  const search = document.querySelector<HTMLInputElement>('[aria-label="Search tags"]')!;
  await typeInput(search, "   ");
  expect(document.body.textContent).not.toContain("Create new tag");
  expect(
    document.querySelector('[data-slot="combobox-status"]')?.textContent?.replaceAll("\u2060", ""),
  ).toBe("Tags");
  await typeInput(search, "REF");
  expect(document.body.textContent).not.toContain("Create new tag");
});

it("opens the color chooser from the dot without selecting the row", async () => {
  await mountPicker();
  await act(async () => container.querySelector("button")!.click());
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="Change color for v3 refactor"]')!
      .click(),
  );
  expect(useDraftTagStore.getState().byDraftId[draftId]).toBeUndefined();
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Teal tag color"]')!.click(),
  );
  const apply = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Apply color",
  )!;
  await act(async () => apply.click());
  expect(useDraftTagStore.getState().byDraftId[draftId]).toEqual({
    label: "v3 refactor",
    color: "#14b8a6",
  });
  expect(document.querySelector('[role="listbox"]')).not.toBeNull();
});

it.each(["right click", "three dots"])(
  "opens the tag editor through %s without selecting first",
  async (method) => {
    await mountPicker();
    await act(async () => container.querySelector("button")!.click());
    if (method === "right click") {
      await act(async () =>
        document
          .querySelector('[role="option"]')!
          .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })),
      );
    } else {
      await clickRowAction(
        document.querySelector<HTMLButtonElement>('[aria-label="Actions for tag v3 refactor"]')!,
      );
    }
    expect(useDraftTagStore.getState().byDraftId[draftId]).toBeUndefined();
    const rename = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (node) => node.textContent === "Rename tag...",
    )!;
    await act(async () => rename.click());
    const labelInput = document.querySelector<HTMLInputElement>(
      '[placeholder="e.g. v3 refactor"]',
    )!;
    expect(labelInput.value).toBe("v3 refactor");
    await typeInput(labelInput, "Renamed");
    const save = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Save",
    )!;
    await act(async () => save.click());
    expect(useDraftTagStore.getState().byDraftId[draftId]).toEqual({
      label: "Renamed",
      color: "#a855f7",
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  },
);

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
  const search = document.querySelector<HTMLInputElement>('[aria-label="Search tags"]')!;
  await act(async () => search.focus());
  await act(async () =>
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
  );
  await act(async () =>
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
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

it("writes a saved thread's new label to its own destination without changing the source", async () => {
  state.draft = false;
  await mountPicker();
  await act(async () => container.querySelector("button")!.click());
  await typeInput(
    document.querySelector<HTMLInputElement>('[aria-label="Search tags"]')!,
    "Mobile",
  );
  await choose('Create new tag "Mobile"');
  expect(state.save).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { threadId: threadRef.threadId, tag: { label: "Mobile", color: null } },
  });
  expect(state.snapshot).toEqual({ active: { label: "v3 refactor", color: "#a855f7" } });
  expect(useDraftTagStore.getState().byDraftId).toEqual({});
});

it("applies a color change only to the current saved thread", async () => {
  state.draft = false;
  await mountPicker();
  await act(async () => container.querySelector("button")!.click());
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="Change color for v3 refactor"]')!
      .click(),
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Green tag color"]')!.click(),
  );
  const apply = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Apply color",
  )!;
  await act(async () => apply.click());
  expect(state.save).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { threadId: threadRef.threadId, tag: { label: "v3 refactor", color: "#22c55e" } },
  });
  expect(state.snapshot?.active?.color).toBe("#a855f7");
});

it("keeps a failed selection open and retries without losing the searched label", async () => {
  state.draft = false;
  state.save.mockRejectedValueOnce(new Error("Connection lost"));
  await mountPicker();
  await act(async () => container.querySelector("button")!.click());
  const search = document.querySelector<HTMLInputElement>('[aria-label="Search tags"]')!;
  await typeInput(search, "Mobile");
  await choose('Create new tag "Mobile"');
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Connection lost");
  expect(search.value).toBe("Mobile");
  await choose('Create new tag "Mobile"');
  expect(state.save).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[role="listbox"]')).toBeNull();
});

it("does not offer mutations before the current saved thread's tags have loaded", async () => {
  state.draft = false;
  state.snapshot = null;
  await mountPicker();
  await act(async () => container.querySelector("button")!.click());
  await typeInput(
    document.querySelector<HTMLInputElement>('[aria-label="Search tags"]')!,
    "Mobile",
  );
  expect(document.querySelector('[role="option"]')).toBeNull();
  expect(state.save).not.toHaveBeenCalled();
});

it("dismisses when the current tag is selected again", async () => {
  useDraftTagStore.getState().select(draftId, { label: "v3 refactor", color: "#a855f7" });
  await mountPicker();
  await act(async () => container.querySelector("button")!.click());
  await choose("v3 refactor");
  expect(document.querySelector('[role="listbox"]')).toBeNull();
});

/** Model the temporary composer strip disappearing after its picker or editor closes. */
function TemporaryTagPicker() {
  const [visible, setVisible] = useState(true);
  if (!visible) return <span>Picker closed</span>;
  return <ThreadTagMenu draftId={draftId} threadRef={threadRef} onOpenChange={setVisible} />;
}

it("keeps the rename dialog mounted until editing finishes in a temporary composer strip", async () => {
  await act(async () =>
    root.render(
      <AppAtomRegistryProvider>
        <TemporaryTagPicker />
      </AppAtomRegistryProvider>,
    ),
  );
  await act(async () => container.querySelector("button")!.click());
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="Actions for tag v3 refactor"]')!
      .click(),
  );
  const rename = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (node) => node.textContent === "Rename tag...",
  )!;
  await act(async () => rename.click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  const cancel = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Cancel",
  )!;
  await act(async () => cancel.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).toBe("Picker closed");
  expect(useDraftTagStore.getState().byDraftId[draftId]).toBeUndefined();
});

it("switches to server writes after a draft becomes a saved thread", async () => {
  useDraftTagStore.getState().select(draftId, { label: "Unsent selection", color: null });
  await mountPicker();
  expect(container.textContent).toBe("Unsent selection");
  state.draft = false;
  await mountPicker();
  await act(async () => container.querySelector("button")!.click());
  await choose("v3 refactor");
  expect(state.save).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { threadId: threadRef.threadId, tag: { label: "v3 refactor", color: "#a855f7" } },
  });
  expect(useDraftTagStore.getState().byDraftId[draftId]?.label).toBe("Unsent selection");
});
