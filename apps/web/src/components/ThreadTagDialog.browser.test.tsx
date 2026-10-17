import { EnvironmentId, ThreadId, type ThreadTags } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { userEvent } from "vite-plus/test/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Cause from "effect/Cause";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({
  snapshot: { thread: { label: "before" } } as ThreadTags | null,
  allowed: true,
  save: vi.fn(),
}));
vi.mock("../state/threadTags", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    threadTagEnvironment: {
      snapshotAtom: () => Atom.make(state.snapshot),
      supportedAtom: () => Atom.make(true),
      failedAtom: () => Atom.make(false),
      set: { permissionAtom: () => Atom.make(state.allowed) },
    },
  };
});
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => state.save }));
vi.mock("./ui/dialog", () => {
  /** Keep the real editor state while replacing portal-only layout wrappers. */
  const wrapper = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: wrapper,
    DialogPopup: wrapper,
    DialogHeader: wrapper,
    DialogTitle: wrapper,
    DialogDescription: wrapper,
    DialogPanel: wrapper,
    DialogFooter: wrapper,
  };
});
vi.mock("./ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => children,
  PopoverPopup: ({ children }: { children: ReactNode }) => children,
  PopoverTrigger: ({ render }: { render: ReactNode }) => render,
}));

import { requestThreadTag, ThreadTagDialogHost } from "./ThreadTagDialog";
const threadRef = {
  environmentId: EnvironmentId.make("remote"),
  threadId: ThreadId.make("thread"),
};
let root: Root;
let container: HTMLDivElement;

/** Find a native test button by the visible action label. */
function button(label: string) {
  return [...container.querySelectorAll("button")].find((node) => node.textContent === label)!;
}

/** Find the label draft independently of the custom picker's numeric and color fields. */
function labelInputs() {
  return [...container.querySelectorAll<HTMLInputElement>('input[placeholder="e.g. v3 refactor"]')];
}

/** Mount the shared host after requesting a particular thread. */
async function openEditor(): Promise<void> {
  await act(async () => {
    if (root) root.unmount();
    container?.remove();
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    requestThreadTag(threadRef);
    root.render(<ThreadTagDialogHost />);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.snapshot = { thread: { label: "before" } };
  state.allowed = true;
  state.save.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

describe("thread tag editor", () => {
  it("saves a trimmed label to the thread's destination and closes after success", async () => {
    await openEditor();
    await act(async () => userEvent.fill(labelInputs()[0]!, "  v3 refactor  "));
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(state.save).toHaveBeenCalledWith({
      environmentId: "remote",
      input: { threadId: "thread", tag: { label: "v3 refactor", color: null } },
    });
    expect(labelInputs()).toHaveLength(0);
  });

  it.each(["clear button", "blank input"])("removes the override through %s", async (method) => {
    await openEditor();
    if (method === "clear button") await act(async () => button("Clear tag").click());
    else {
      await act(async () => userEvent.fill(labelInputs()[0]!, "   "));
      await act(async () =>
        container
          .querySelector("form")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
    }
    expect(state.save).toHaveBeenCalledWith({
      environmentId: "remote",
      input: { threadId: "thread", tag: null },
    });
  });

  it("cancels without changing the stored tag", async () => {
    await openEditor();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Teal tag color"]')!.click(),
    );
    await act(async () => button("Cancel").click());
    expect(state.save).not.toHaveBeenCalled();
    expect(labelInputs()).toHaveLength(0);
  });

  it("keeps the draft and error visible after a failed save", async () => {
    state.save.mockResolvedValue({
      _tag: "Failure",
      cause: Cause.fail(new Error("Could not save")),
    });
    await openEditor();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Violet tag color"]')!.click(),
    );
    await act(async () => userEvent.fill(labelInputs()[0]!, "keep me"));
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(labelInputs()[0]!.value).toBe("keep me");
    expect(container.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    state.save.mockResolvedValue({ _tag: "Success", value: undefined });
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(state.save).toHaveBeenLastCalledWith({
      environmentId: "remote",
      input: { threadId: "thread", tag: { label: "keep me", color: "#8b5cf6" } },
    });
  });

  it("saves a preset color with the label and reloads it when editing again", async () => {
    await openEditor();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Teal tag color"]')!.click(),
    );
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(state.save).toHaveBeenLastCalledWith({
      environmentId: "remote",
      input: { threadId: "thread", tag: { label: "before", color: "#14b8a6" } },
    });
    state.snapshot = { thread: { label: "before", color: "#14b8a6" } };
    await openEditor();
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(state.save).toHaveBeenLastCalledWith({
      environmentId: "remote",
      input: { threadId: "thread", tag: { label: "before", color: "#14b8a6" } },
    });
  });

  it("saves a custom hex color through the theme picker and can reset it", async () => {
    await openEditor();
    await act(async () =>
      userEvent.fill(
        container.querySelector<HTMLInputElement>('input[aria-label="Tag picker hex value"]')!,
        "#123ABC",
      ),
    );
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(state.save).toHaveBeenLastCalledWith({
      environmentId: "remote",
      input: { threadId: "thread", tag: { label: "before", color: "#123abc" } },
    });
    state.snapshot = { thread: { label: "before", color: "#123abc" } };
    await openEditor();
    await act(async () => button("Default").click());
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(state.save).toHaveBeenLastCalledWith({
      environmentId: "remote",
      input: { threadId: "thread", tag: { label: "before", color: null } },
    });
  });

  it.each(["loading", "read-only"])("does not expose an editable form while %s", async (mode) => {
    if (mode === "loading") state.snapshot = null;
    else state.allowed = false;
    await openEditor();
    expect(labelInputs()).toHaveLength(0);
    await act(async () => button("Close").click());
    expect(state.save).not.toHaveBeenCalled();
  });

  it("does not dismiss another thread's editor when an earlier save finishes", async () => {
    let finish!: (saved: { _tag: "Success"; value: undefined }) => void;
    state.save.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await openEditor();
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await act(async () => requestThreadTag({ ...threadRef, threadId: ThreadId.make("another") }));
    await act(async () => finish({ _tag: "Success", value: undefined }));
    expect(labelInputs()).toHaveLength(1);
  });
});
