import { EnvironmentId, ThreadId, type ThreadTags } from "@t3tools/contracts";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Cause from "effect/Cause";
import type { ComponentProps, ReactNode } from "react";

const state = vi.hoisted(() => ({
  snapshot: { thread: { label: "before" } } as ThreadTags | null,
  allowed: true,
  save: vi.fn(),
}));
vi.mock("../state/threadTags", () => ({
  threadTagEnvironment: {
    snapshotAtom: () => "snapshot",
    supportedAtom: () => "supported",
    failedAtom: () => "failed",
    set: { permissionAtom: () => "allowed" },
  },
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: string) => {
    if (atom === "snapshot") return state.snapshot;
    if (atom === "allowed") return state.allowed;
    return atom === "supported";
  },
}));
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
vi.mock("./ui/button", () => ({
  Button: ({ variant: _variant, ...props }: ComponentProps<"button"> & { variant?: string }) => (
    <button {...props} />
  ),
}));
vi.mock("./ui/input", () => ({ Input: (props: ComponentProps<"input">) => <input {...props} /> }));
vi.mock("./ui/label", () => ({ Label: (props: ComponentProps<"label">) => <label {...props} /> }));
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
let renderer: ReactTestRenderer;

/** Find a native test button by the visible action label. */
function button(label: string) {
  return renderer.root.findAllByType("button").find((node) => node.children.join("") === label)!;
}

/** Find the label draft independently of the custom picker's numeric and color fields. */
function labelInputs() {
  return renderer.root
    .findAllByType("input")
    .filter((node) => node.props.placeholder === "e.g. v3 refactor");
}

/** Mount the shared host after requesting a particular thread. */
async function openEditor(): Promise<void> {
  await act(async () => {
    renderer?.unmount();
    requestThreadTag(threadRef);
    renderer = create(<ThreadTagDialogHost />);
  });
}

beforeEach(() => {
  state.snapshot = { thread: { label: "before" } };
  state.allowed = true;
  state.save.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
});

describe("thread tag editor", () => {
  it("saves a trimmed label to the thread's destination and closes after success", async () => {
    await openEditor();
    await act(async () =>
      labelInputs()[0]!.props.onChange({ target: { value: "  v3 refactor  " } }),
    );
    await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
    expect(state.save).toHaveBeenCalledWith({
      environmentId: "remote",
      input: { threadId: "thread", tag: { label: "v3 refactor", color: null } },
    });
    expect(labelInputs()).toHaveLength(0);
  });

  it.each(["clear button", "blank input"])("removes the override through %s", async (method) => {
    await openEditor();
    if (method === "clear button") await act(async () => button("Clear tag").props.onClick());
    else {
      await act(async () => labelInputs()[0]!.props.onChange({ target: { value: "   " } }));
      await act(async () =>
        renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }),
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
      renderer.root.findByProps({ "aria-label": "Teal tag color" }).props.onClick(),
    );
    await act(async () => button("Cancel").props.onClick());
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
      renderer.root.findByProps({ "aria-label": "Violet tag color" }).props.onClick(),
    );
    await act(async () => labelInputs()[0]!.props.onChange({ target: { value: "keep me" } }));
    await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
    expect(labelInputs()[0]!.props.value).toBe("keep me");
    expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toBeTruthy();
    state.save.mockResolvedValue({ _tag: "Success", value: undefined });
    await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
    expect(state.save).toHaveBeenLastCalledWith({
      environmentId: "remote",
      input: { threadId: "thread", tag: { label: "keep me", color: "#8b5cf6" } },
    });
  });

  it("saves a preset color with the label and reloads it when editing again", async () => {
    await openEditor();
    await act(async () =>
      renderer.root.findByProps({ "aria-label": "Teal tag color" }).props.onClick(),
    );
    await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
    expect(state.save).toHaveBeenLastCalledWith({
      environmentId: "remote",
      input: { threadId: "thread", tag: { label: "before", color: "#14b8a6" } },
    });
    state.snapshot = { thread: { label: "before", color: "#14b8a6" } };
    await openEditor();
    await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
    expect(state.save).toHaveBeenLastCalledWith({
      environmentId: "remote",
      input: { threadId: "thread", tag: { label: "before", color: "#14b8a6" } },
    });
  });

  it("saves a custom hex color through the theme picker and can reset it", async () => {
    await openEditor();
    await act(async () =>
      renderer.root.findByProps({ "aria-label": "Tag picker hex value" }).props.onChange({
        currentTarget: { value: "#123ABC" },
      }),
    );
    await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
    expect(state.save).toHaveBeenLastCalledWith({
      environmentId: "remote",
      input: { threadId: "thread", tag: { label: "before", color: "#123abc" } },
    });
    state.snapshot = { thread: { label: "before", color: "#123abc" } };
    await openEditor();
    await act(async () => button("Default").props.onClick());
    await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
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
    await act(async () => button("Close").props.onClick());
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
    await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
    await act(async () => requestThreadTag({ ...threadRef, threadId: ThreadId.make("another") }));
    await act(async () => finish({ _tag: "Success", value: undefined }));
    expect(labelInputs()).toHaveLength(1);
  });
});
