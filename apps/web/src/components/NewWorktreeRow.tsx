import { DEFAULT_SOFT_PILL_COLOR } from "@t3tools/client-runtime/soft-pill-colors";
import { WorktreeDirectoryName } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import type { WorkspaceColorMode, WorkspaceColorChoice } from "@t3tools/contracts";
import { getClientSettings } from "../hooks/useSettings";
import { createWorkspaceColorSelection } from "../workspaceColorSelection";
import type { NamedWorktreeSelection } from "../namedWorktreeStore";
import { Input } from "./ui/input";
import { MenuRadioItem } from "./ui/menu";
import { WorktreeColorPicker } from "./WorktreeColorPicker";

const isWorktreeDirectoryName = Schema.is(WorktreeDirectoryName);

/** Keep automatic and named creation in one selectable row, with no submit action. */
export function NewWorktreeRow({
  selection,
  defaultColorChoice,
  active = false,
  disabled,
  nameRequired = false,
  onSelect,
  onSelectionChange,
}: {
  selection: NamedWorktreeSelection | null;
  defaultColorChoice?: WorkspaceColorChoice;
  active?: boolean;
  disabled: boolean;
  nameRequired?: boolean;
  onSelect: (selection: NamedWorktreeSelection | null) => void;
  onSelectionChange?: (selection: NamedWorktreeSelection | null) => void;
}) {
  const [name, setName] = useState(selection?.name ?? "");
  const [initialColor] = useState(
    () =>
      selection ??
      createWorkspaceColorSelection(
        defaultColorChoice ?? getClientSettings().forkDefaultWorkspaceColor,
      ),
  );
  const [color, setColor] = useState(initialColor.color);
  const [colorMode, setColorMode] = useState(initialColor.colorMode);
  const directoryName = name.trim();
  const invalid = directoryName.length > 0 && !isWorktreeDirectoryName(directoryName);

  /** Save valid choices while letting the caller decide whether to close the menu. */
  function saveSelection(
    nextName: string,
    nextColor: string,
    commit: typeof onSelectionChange,
    nextMode: WorkspaceColorMode | null = colorMode ?? null,
  ) {
    const nextDirectoryName = nextName.trim();
    if (disabled || (nameRequired && !nextDirectoryName)) return;
    if (nextDirectoryName && !isWorktreeDirectoryName(nextDirectoryName)) return;
    commit?.(
      nextDirectoryName || nextColor !== DEFAULT_SOFT_PILL_COLOR || nextMode
        ? {
            name: nextDirectoryName,
            color: nextColor,
            ...(nextMode ? { colorMode: nextMode } : {}),
          }
        : null,
    );
  }

  /** Confirm creation when the row or Enter is pressed. */
  function select() {
    saveSelection(name, color, onSelect);
  }

  return (
    <>
      <MenuRadioItem
        value="worktree"
        closeOnClick={false}
        data-workspace-initial-focus={active && !selection?.name.trim() ? "" : undefined}
        disabled={disabled}
        onClick={select}
      >
        <span className="flex items-center gap-2">
          <span className="flex shrink-0 items-center gap-2">
            <PlusIcon className="size-3" />
            New worktree
          </span>
          <span
            className="min-w-0 flex-1"
            onClick={(event) => event.stopPropagation()}
            onFocus={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== "Escape") event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                select();
              }
            }}
          >
            <Input
              size="compact"
              aria-label="Worktree name"
              data-workspace-initial-focus={active && selection?.name.trim() ? "" : undefined}
              placeholder={nameRequired ? "Name (required)" : "Name (optional)"}
              aria-required={nameRequired}
              value={name}
              disabled={disabled}
              aria-invalid={invalid}
              onFocus={() => saveSelection(name, color, onSelectionChange)}
              onChange={(event) => {
                const nextName = event.target.value;
                setName(nextName);
                saveSelection(nextName, color, onSelectionChange);
              }}
            />
          </span>
          <span
            className="shrink-0"
            onClick={(event) => event.stopPropagation()}
            onFocus={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== "Escape") event.stopPropagation();
            }}
          >
            <WorktreeColorPicker
              color={color}
              colorMode={colorMode}
              disabled={disabled}
              onOpen={() => saveSelection(name, color, onSelectionChange)}
              onChange={(nextColor, nextMode) => {
                setColor(nextColor);
                setColorMode(nextMode);
                saveSelection(name, nextColor, onSelectionChange, nextMode ?? null);
              }}
            />
          </span>
        </span>
      </MenuRadioItem>
      {invalid ? (
        <p className="px-2 py-1 text-xs text-destructive">
          Enter a directory name without path separators.
        </p>
      ) : null}
    </>
  );
}
