import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { NewWorktreeRow } from "./NewWorktreeRow";
import { Menu, MenuPopup, MenuRadioGroup, MenuTrigger } from "./ui/menu";

let root: Root;
let container: HTMLDivElement;
const onSelect = vi.fn();

/** Exercise real menu focus and closing behavior around the editable controls. */
function Picker() {
  const [open, setOpen] = useState(false);
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger>Workspace</MenuTrigger>
      <MenuPopup>
        <MenuRadioGroup value="local">
          <NewWorktreeRow
            selection={null}
            disabled={false}
            onSelect={(selection) => {
              onSelect(selection);
              setOpen(false);
            }}
          />
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onSelect.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Picker />));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** Change the native input so React and Base UI both process the edit. */
async function typeName(name: string) {
  const input = document.querySelector<HTMLInputElement>('[aria-label="Worktree name"]')!;
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Select the creation action independently of its adjacent editor. */
async function selectRow() {
  await act(async () => document.querySelector<HTMLElement>('[role="menuitemradio"]')!.click());
}

it("starts empty with color disabled and selects ordinary creation", async () => {
  expect(document.querySelector<HTMLInputElement>('[aria-label="Worktree name"]')!.value).toBe("");
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Worktree color"]')!.disabled).toBe(
    true,
  );
  await selectRow();
  expect(onSelect).toHaveBeenCalledWith(null);
});

it("keeps editing and color selection open until the creation row is selected", async () => {
  await typeName("  billing-fix  ");
  expect(onSelect).not.toHaveBeenCalled();
  const colorTrigger = document.querySelector<HTMLButtonElement>('[aria-label="Worktree color"]')!;
  expect(colorTrigger.disabled).toBe(false);
  await act(async () => colorTrigger.click());
  const teal = document.querySelector<HTMLButtonElement>('[aria-label="Teal worktree color"]')!;
  await act(async () => teal.click());
  expect(onSelect).not.toHaveBeenCalled();
  expect(document.querySelector('[aria-label="Worktree name"]')).not.toBeNull();
  await selectRow();
  expect(onSelect).toHaveBeenCalledWith({ name: "billing-fix", color: "#14b8a6" });
});

it("returns to automatic creation after clearing the name", async () => {
  await typeName("billing-fix");
  await typeName(" ");
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Worktree color"]')!.disabled).toBe(
    true,
  );
  await selectRow();
  expect(onSelect).toHaveBeenCalledWith(null);
});

it("rejects traversal without closing or selecting the row", async () => {
  await typeName("../outside");
  await selectRow();
  expect(onSelect).not.toHaveBeenCalled();
  expect(document.querySelector('[aria-label="Worktree name"]')).not.toBeNull();
});

it("dismisses editing with Escape without committing the name", async () => {
  await typeName("billing-fix");
  const input = document.querySelector<HTMLInputElement>('[aria-label="Worktree name"]')!;
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(onSelect).not.toHaveBeenCalled();
  expect(document.querySelector('[role="menu"]')?.hasAttribute("data-ending-style") ?? true).toBe(
    true,
  );
});

it("lets an invalid name be corrected before selecting the full creation row", async () => {
  await typeName("../outside");
  await typeName("billing-fix");
  const row = document.querySelector<HTMLElement>('[role="menuitemradio"]')!;
  expect(row.contains(document.querySelector('[aria-label="Worktree name"]'))).toBe(true);
  expect(row.contains(document.querySelector('[aria-label="Worktree color"]'))).toBe(true);
  await selectRow();
  expect(onSelect).toHaveBeenCalledWith({ name: "billing-fix", color: "#8b5cf6" });
});
