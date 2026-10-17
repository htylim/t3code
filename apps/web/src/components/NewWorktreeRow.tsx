import { SOFT_PILL_COLOR_PRESETS } from "@t3tools/client-runtime/soft-pill-colors";
import { WorktreeDirectoryName } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import type { NamedWorktreeSelection } from "../namedWorktreeStore";
import { Input } from "./ui/input";
import { MenuRadioItem } from "./ui/menu";
import { WorktreeColorPicker } from "./WorktreeColorPicker";

const isWorktreeDirectoryName = Schema.is(WorktreeDirectoryName);

/** Keep automatic and named creation in one selectable row, with no submit action. */
export function NewWorktreeRow({
  selection,
  active = false,
  disabled,
  onSelect,
}: {
  selection: NamedWorktreeSelection | null;
  active?: boolean;
  disabled: boolean;
  onSelect: (selection: NamedWorktreeSelection | null) => void;
}) {
  const [name, setName] = useState(selection?.name ?? "");
  const [color, setColor] = useState(selection?.color ?? SOFT_PILL_COLOR_PRESETS[0].color);
  const directoryName = name.trim();
  const invalid = directoryName.length > 0 && !isWorktreeDirectoryName(directoryName);

  /** Commit the current values only when the row is selected. */
  function select() {
    if (disabled || invalid) return;
    onSelect(directoryName ? { name: directoryName, color } : null);
  }

  return (
    <>
      <MenuRadioItem
        value="worktree"
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
              placeholder="Name (optional)"
              value={name}
              disabled={disabled}
              aria-invalid={invalid}
              onChange={(event) => setName(event.target.value)}
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
              disabled={disabled || !directoryName || invalid}
              onChange={setColor}
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
