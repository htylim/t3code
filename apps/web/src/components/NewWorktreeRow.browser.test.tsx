import { act, render as renderScreen } from "../../test/render";
import "../index.css";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import type { NamedWorktreeSelection } from "../namedWorktreeStore";
import { NewWorktreeRow } from "./NewWorktreeRow";
import { Menu, MenuPopup, MenuRadioGroup, MenuTrigger } from "./ui/menu";
const onSelect = vi.fn();
const onSelectionChange = vi.fn();

/** Exercise real menu focus and closing behavior around the editable controls. */
function Picker({ nameRequired = false }: { nameRequired?: boolean }) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<NamedWorktreeSelection | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState("local");

  /** Persist composer edits without closing the picker or creating a checkout. */
  function changeSelection(nextSelection: NamedWorktreeSelection | null) {
    onSelectionChange(nextSelection);
    setSelection(nextSelection);
    setWorkspaceMode("worktree");
  }
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger>Workspace</MenuTrigger>
      <MenuPopup>
        <MenuRadioGroup value={workspaceMode}>
          <NewWorktreeRow
            selection={selection}
            active={workspaceMode === "worktree"}
            disabled={false}
            nameRequired={nameRequired}
            {...(nameRequired ? {} : { onSelectionChange: changeSelection })}
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

/** Own the rendered tree and fixture cleanup for one test. */
async function createTestSurface() {
  onSelect.mockReset();
  onSelectionChange.mockReset();
  const container = document.createElement("div");
  document.body.append(container);
  const screen = await renderScreen(null, { container });
  await act(async () => screen.rerender(<Picker />));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());

  return {
    screen,
    container,
    async [Symbol.asyncDispose]() {
      try {
        vi.unstubAllGlobals();
      } finally {
        await screen[Symbol.asyncDispose]();
      }
    },
  };
}

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

it("starts empty with color enabled and selects ordinary creation", async () => {
  await using _surface = await createTestSurface();

  expect(document.querySelector<HTMLInputElement>('[aria-label="Worktree name"]')!.value).toBe("");
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Worktree color"]')!.disabled).toBe(
    false,
  );
  await selectRow();
  expect(onSelect).toHaveBeenCalledWith(null);
});

it("keeps editing and color selection open until the creation row is selected", async () => {
  await using _surface = await createTestSurface();

  await typeName("  billing-fix  ");
  expect(onSelect).not.toHaveBeenCalled();
  expect(onSelectionChange).toHaveBeenLastCalledWith({ name: "billing-fix", color: "#808080" });
  const colorTrigger = document.querySelector<HTMLButtonElement>('[aria-label="Worktree color"]')!;
  expect(colorTrigger.disabled).toBe(false);
  await act(async () => colorTrigger.click());
  const teal = document.querySelector<HTMLButtonElement>('[aria-label="Teal worktree color"]')!;
  await act(async () => teal.click());
  expect(onSelect).not.toHaveBeenCalled();
  expect(onSelectionChange).toHaveBeenLastCalledWith({ name: "billing-fix", color: "#14b8a6" });
  expect(document.querySelector('[aria-label="Worktree name"]')).not.toBeNull();
  await selectRow();
  expect(onSelect).toHaveBeenCalledWith({ name: "billing-fix", color: "#14b8a6" });
});

it("keeps the selected color for automatic creation after clearing the name", async () => {
  await using _surface = await createTestSurface();

  await typeName("billing-fix");
  await userEvent.click(page.getByRole("button", { name: "Worktree color", exact: true }));
  await userEvent.click(page.getByRole("button", { name: "Teal worktree color" }));
  await typeName(" ");
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Worktree color"]')!.disabled).toBe(
    false,
  );
  await selectRow();
  expect(onSelect).toHaveBeenCalledWith({ name: "", color: "#14b8a6" });
});

it("selects a color without entering a name and keeps automatic naming", async () => {
  await using _surface = await createTestSurface();

  await userEvent.click(page.getByRole("button", { name: "Worktree color", exact: true }));
  await userEvent.click(page.getByRole("button", { name: "Teal worktree color" }));
  expect(onSelect).not.toHaveBeenCalled();
  expect(onSelectionChange).toHaveBeenLastCalledWith({ name: "", color: "#14b8a6" });
  await selectRow();
  expect(onSelect).toHaveBeenCalledWith({ name: "", color: "#14b8a6" });
});

it("requires a name during workspace editing while leaving the name input usable", async () => {
  await using surface = await createTestSurface();
  const { screen } = surface;

  await act(async () => screen.rerender(<Picker nameRequired />));
  const row = document.querySelector<HTMLElement>('[role="menuitemradio"]')!;
  const input = document.querySelector<HTMLInputElement>('[aria-label="Worktree name"]')!;
  expect(input.disabled).toBe(false);
  expect(input.placeholder).toBe("Name (required)");
  await userEvent.click(row);
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(onSelect).not.toHaveBeenCalled();
  await userEvent.fill(page.getByLabelText("Worktree name"), "billing-fix");
  await selectRow();
  expect(onSelect).toHaveBeenCalledWith({ name: "billing-fix", color: "#808080" });
});

it("blocks creation again when a required name is cleared", async () => {
  await using surface = await createTestSurface();
  const { screen } = surface;

  await act(async () => screen.rerender(<Picker nameRequired />));
  await typeName("billing-fix");
  await typeName(" ");
  await userEvent.click(page.getByRole("menuitemradio"));
  expect(onSelect).not.toHaveBeenCalled();
  expect(document.querySelector('[aria-label="Worktree name"]')).not.toBeNull();
});

it("rejects traversal without closing or selecting the row", async () => {
  await using _surface = await createTestSurface();

  await typeName("../outside");
  await selectRow();
  expect(onSelect).not.toHaveBeenCalled();
  expect(document.querySelector('[aria-label="Worktree name"]')).not.toBeNull();
});

it("keeps the edited draft selection when Escape dismisses the picker", async () => {
  await using _surface = await createTestSurface();

  await typeName("billing-fix");
  const input = document.querySelector<HTMLInputElement>('[aria-label="Worktree name"]')!;
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(onSelect).not.toHaveBeenCalled();
  expect(onSelectionChange).toHaveBeenLastCalledWith({ name: "billing-fix", color: "#808080" });
  expect(document.querySelector('[role="menu"]')?.hasAttribute("data-ending-style") ?? true).toBe(
    true,
  );
});

it("selects New worktree when the name input is focused and keeps it after clicking away", async () => {
  await using _surface = await createTestSurface();

  await userEvent.click(page.getByLabelText("Worktree name"));
  expect(page.getByRole("menuitemradio").element().getAttribute("aria-checked")).toBe("true");
  expect(onSelectionChange).toHaveBeenLastCalledWith(null);
  await userEvent.click(document.body);
  await userEvent.click(page.getByRole("button", { name: "Workspace", exact: true }));
  expect(page.getByRole("menuitemradio").element().getAttribute("aria-checked")).toBe("true");
  expect(document.querySelector<HTMLInputElement>('[aria-label="Worktree name"]')!.value).toBe("");
  expect(onSelect).not.toHaveBeenCalled();
});

it("saves an edited name when clicking away without selecting the row", async () => {
  await using _surface = await createTestSurface();

  await typeName("billing-fix");
  await userEvent.click(document.body);
  await userEvent.click(page.getByRole("button", { name: "Workspace", exact: true }));
  expect(page.getByRole("menuitemradio").element().getAttribute("aria-checked")).toBe("true");
  expect(document.querySelector<HTMLInputElement>('[aria-label="Worktree name"]')!.value).toBe(
    "billing-fix",
  );
  expect(onSelect).not.toHaveBeenCalled();
});

it("selects New worktree when opening its color picker and saves the color on outside click", async () => {
  await using _surface = await createTestSurface();

  await userEvent.click(page.getByRole("button", { name: "Worktree color", exact: true }));
  expect(page.getByRole("menuitemradio").element().getAttribute("aria-checked")).toBe("true");
  await userEvent.click(page.getByRole("button", { name: "Teal worktree color" }));
  await userEvent.click(document.body);
  await userEvent.click(document.body);
  await userEvent.click(page.getByRole("button", { name: "Workspace", exact: true }));
  expect(page.getByRole("menuitemradio").element().getAttribute("aria-checked")).toBe("true");
  expect(onSelectionChange).toHaveBeenLastCalledWith({ name: "", color: "#14b8a6" });
  const swatch = document.querySelector<HTMLElement>('[aria-label="Worktree color"] span')!;
  expect(swatch.style.backgroundColor).toBe("rgb(20, 184, 166)");
  expect(onSelect).not.toHaveBeenCalled();
});

it("lets an invalid name be corrected before selecting the full creation row", async () => {
  await using _surface = await createTestSurface();

  await typeName("../outside");
  await typeName("billing-fix");
  const row = document.querySelector<HTMLElement>('[role="menuitemradio"]')!;
  expect(row.contains(document.querySelector('[aria-label="Worktree name"]'))).toBe(true);
  expect(row.contains(document.querySelector('[aria-label="Worktree color"]'))).toBe(true);
  await selectRow();
  expect(onSelect).toHaveBeenCalledWith({ name: "billing-fix", color: "#808080" });
});

it("offers gray alongside existing colors", async () => {
  await using _surface = await createTestSurface();

  await typeName("billing-fix");
  await userEvent.click(page.getByRole("button", { name: "Worktree color", exact: true }));
  const graySwatch = page.getByRole("button", { name: "Gray worktree color", exact: true });
  expect(graySwatch.element().getAttribute("aria-pressed")).toBe("true");
  await userEvent.click(page.getByRole("button", { name: "Violet worktree color" }));
  await userEvent.click(graySwatch);
  await selectRow();
  expect(onSelect).toHaveBeenCalledWith({ name: "billing-fix", color: "#808080" });
});
