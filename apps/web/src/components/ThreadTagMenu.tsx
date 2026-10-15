import { useAtomValue } from "@effect/atom-react";
import {
  THREAD_TAG_LABEL_MAX_LENGTH,
  type EnvironmentId,
  type ScopedThreadRef,
  type ThreadTag,
  type ThreadTags,
} from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Atom } from "effect/reactivity";
import { CheckIcon, PlusIcon, TagIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import type { DraftId } from "../composerDraftStore";
import { useAtomCommand } from "../state/use-atom-command";
import { ThreadTagColorPicker } from "./ThreadTagColorPicker";
import { Button } from "./ui/button";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "./ui/menu";
import { Popover, PopoverTrigger, PopoverPopup } from "./ui/popover";
import { useThreadShells } from "../state/entities";
import { usePostponedThreadStore } from "../postponedThreadStore";
import { threadTagEnvironment } from "../state/threadTags";
import { ComposerControl, ComposerControlChevron } from "./chat/ComposerControl";
import { useComposerMenuProps } from "./chat/composerEventScope";
import { ThreadTagEditor } from "./ThreadTagDialog";
import { ThreadTagPill } from "./ThreadTagPill";
import {
  Combobox,
  ComboboxTrigger,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxList,
  ComboboxItem,
  ComboboxStatus,
} from "./ui/combobox";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Separator } from "./ui/separator";
import { collectActiveDraftTags, draftTagKey, useDraftTagStore } from "../draftTagStore";

const NEW_TAG_KEY = "new-tag";
const CLEAR_TAG_KEY = "clear-tag";

/** Subscribe to tag sidecars only while the searchable list is open. */
function useActiveTagChoices(open: boolean) {
  const threads = useThreadShells(open);
  const postponed = usePostponedThreadStore((state) => state.byThreadKey);
  const choicesAtom = useMemo(
    () =>
      Atom.make((get) => {
        const tagsByEnvironment = new Map<EnvironmentId, ThreadTags>();
        let loading = false;
        let failed = false;
        for (const environmentId of new Set(threads.map((thread) => thread.environmentId))) {
          if (!get(threadTagEnvironment.supportedAtom(environmentId))) continue;
          const snapshot = get(threadTagEnvironment.snapshotAtom(environmentId));
          if (snapshot) tagsByEnvironment.set(environmentId, snapshot);
          else if (get(threadTagEnvironment.failedAtom(environmentId))) failed = true;
          else loading = true;
        }
        return {
          tags: collectActiveDraftTags({
            threads,
            tagsByEnvironment,
            postponedThreadKeys: new Set(Object.keys(postponed)),
            // Snooze classification matches the sidebar at menu opening.
            now: new Date().toISOString(),
          }),
          loading,
          failed,
        };
      }),
    [postponed, threads],
  );
  return useAtomValue(choicesAtom);
}

/** Select a tag for either an unsent draft or a persisted thread. */
export function ThreadTagMenu({
  draftId,
  threadRef,
  onOpenChange,
}: {
  readonly draftId?: DraftId | undefined;
  readonly threadRef: ScopedThreadRef;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
}) {
  if (draftId) {
    return (
      <DraftTagMenu
        key={draftId}
        draftId={draftId}
        threadRef={threadRef}
        onOpenChange={onOpenChange}
      />
    );
  }
  return (
    <SavedThreadTagMenu
      key={scopedThreadKey(threadRef)}
      threadRef={threadRef}
      onOpenChange={onOpenChange}
    />
  );
}

/** Keep unsent selections local until the draft becomes a server thread. */
function DraftTagMenu({
  draftId,
  threadRef,
  onOpenChange,
}: {
  draftId: DraftId;
  threadRef: ScopedThreadRef;
  onOpenChange?: ((open: boolean) => void) | undefined;
}) {
  const supported = useAtomValue(threadTagEnvironment.supportedAtom(threadRef.environmentId));
  const allowed = useAtomValue(threadTagEnvironment.set.permissionAtom(threadRef.environmentId));
  const tag = useDraftTagStore((state) => state.byDraftId[draftId] ?? null);
  const select = useDraftTagStore((state) => state.select);
  if ((!supported || !allowed) && !tag) return null;
  return (
    <ThreadTagPicker
      tag={tag}
      canSetTag={supported && allowed}
      onOpenChange={onOpenChange}
      triggerLabel="Draft tag"
      onSave={async (nextTag) => {
        if (nextTag && (!supported || !allowed)) return "Tags are unavailable on this connection.";
        select(draftId, nextTag);
        return null;
      }}
    />
  );
}

/** Apply picker changes through the destination environment's guarded tag command. */
function SavedThreadTagMenu({
  threadRef,
  onOpenChange,
}: {
  threadRef: ScopedThreadRef;
  onOpenChange?: ((open: boolean) => void) | undefined;
}) {
  const supported = useAtomValue(threadTagEnvironment.supportedAtom(threadRef.environmentId));
  const allowed = useAtomValue(threadTagEnvironment.set.permissionAtom(threadRef.environmentId));
  const snapshot = useAtomValue(threadTagEnvironment.snapshotAtom(threadRef.environmentId));
  const setTag = useAtomCommand(threadTagEnvironment.set, { reportFailure: false });
  if (!supported || !allowed) return null;
  return (
    <ThreadTagPicker
      tag={snapshot?.[threadRef.threadId] ?? null}
      canSetTag={snapshot !== null}
      onOpenChange={onOpenChange}
      triggerLabel="Thread tag"
      onSave={async (tag) => {
        const saved = await setTag({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, tag },
        });
        if (saved._tag === "Success") return null;
        const failure = squashAtomCommandFailure(saved);
        return failure instanceof Error ? failure.message : "Failed to save thread tag.";
      }}
    />
  );
}

/** Search, create, and edit tags without changing any other thread's tag. */
function ThreadTagPicker({
  tag,
  canSetTag,
  triggerLabel,
  onSave,
  onOpenChange,
}: {
  readonly tag: ThreadTag | null;
  readonly canSetTag: boolean;
  readonly triggerLabel: string;
  readonly onSave: (tag: ThreadTag | null) => Promise<string | null>;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [editingTag, setEditingTag] = useState<ThreadTag | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = useActiveTagChoices(open && canSetTag);
  const menuProps = useComposerMenuProps();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const availableTags = [...choices.tags];
  if (tag && !availableTags.some((choice) => draftTagKey(choice) === draftTagKey(tag))) {
    availableTags.unshift(tag);
  }
  const filteredTags = canSetTag
    ? availableTags.filter((choice) => choice.label.toLocaleLowerCase().includes(normalizedQuery))
    : [];
  const canCreate = canSetTag && normalizedQuery.length > 0 && filteredTags.length === 0;
  const keys = filteredTags.map(draftTagKey);
  if (canCreate) keys.push(NEW_TAG_KEY);
  if (tag) keys.push(CLEAR_TAG_KEY);
  const selectedKey = tag ? draftTagKey(tag) : null;
  let emptyMessage = "No tags on active threads.";
  if (choices.loading) emptyMessage = "Loading tags...";
  else if (choices.failed) emptyMessage = "Tags could not be loaded.";

  /** Reveal the composer strip only for the duration of an open picker. */
  function changeOpen(nextOpen: boolean): void {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  /** Keep the temporary composer strip mounted until the editor finishes. */
  function closeEditor(): void {
    setEditingTag(null);
    onOpenChange?.(false);
  }

  /** Keep failures visible and dismiss the picker only after a successful selection. */
  async function saveSelection(nextTag: ThreadTag | null, close: boolean): Promise<string | null> {
    if (saving) return "A tag change is already being saved.";
    setSaving(true);
    setError(null);
    try {
      const failure = await onSave(nextTag);
      setError(failure);
      if (failure === null && close) {
        if (editingTag) setOpen(false);
        else changeOpen(false);
        setQuery("");
      }
      return failure;
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "Failed to save thread tag.";
      setError(message);
      return message;
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Combobox
        items={keys}
        filteredItems={keys}
        filter={null}
        autoHighlight
        value={selectedKey}
        inputValue={query}
        onInputValueChange={setQuery}
        open={open}
        onOpenChange={(nextOpen, details) => {
          if (overlayOpen || details.reason === "item-press") return;
          changeOpen(nextOpen);
          if (!nextOpen) setQuery("");
        }}
        onValueChange={(key) => {
          if (saving) return;
          if (key === NEW_TAG_KEY) {
            void saveSelection({ label: query.trim(), color: null }, true);
          } else if (key === CLEAR_TAG_KEY) void saveSelection(null, true);
          else {
            const choice = filteredTags.find((candidate) => draftTagKey(candidate) === key);
            if (choice) void saveSelection(choice, true);
          }
        }}
      >
        <ComboboxTrigger
          render={<ComposerControl size="xs" />}
          aria-label={`${triggerLabel}: ${tag?.label ?? "No Tag"}`}
          data-composer-shortcut="thread.tag"
          data-composer-context-control
          className="min-w-0 shrink"
        >
          <TagIcon
            className={tag ? "hidden size-3 group-data-[compact]/composer-context:block" : "size-3"}
          />
          <span
            data-composer-label
            className="min-w-0 max-w-40 group-data-[compact]/composer-context:max-w-0"
          >
            <span data-composer-label-motion className="block max-w-40 truncate">
              {tag ? <ThreadTagPill label={tag.label} color={tag.color ?? null} /> : "No Tag"}
            </span>
          </span>
          <ComposerControlChevron size="xs" />
        </ComboboxTrigger>
        <ComboboxPopup align="start" side="top" className="w-72" {...menuProps}>
          <ComboboxSearchInput
            aria-label="Search tags"
            placeholder="Search tags..."
            maxLength={THREAD_TAG_LABEL_MAX_LENGTH}
          />
          <ComboboxStatus>Tags</ComboboxStatus>
          <ComboboxList>
            {canSetTag
              ? filteredTags.map((choice) => (
                  <TagChoiceRow
                    key={draftTagKey(choice)}
                    tag={choice}
                    selected={draftTagKey(choice) === selectedKey}
                    disabled={saving}
                    onOverlayOpenChange={setOverlayOpen}
                    onColorSave={(color) => saveSelection({ label: choice.label, color }, false)}
                    onEdit={() => {
                      setEditingTag(choice);
                      setOpen(false);
                      setQuery("");
                    }}
                  />
                ))
              : null}
            {filteredTags.length === 0 && canSetTag && !canCreate ? (
              <p role="status" className="px-2 py-1 text-sm text-muted-foreground">
                {emptyMessage}
              </p>
            ) : null}
            {canCreate ? (
              <ComboboxItem value={NEW_TAG_KEY} disabled={saving}>
                <PlusIcon />
                Create new tag &quot;{query.trim()}&quot;
              </ComboboxItem>
            ) : null}
            {tag ? (
              <>
                <div className="py-1">
                  <Separator />
                </div>
                <ComboboxItem value={CLEAR_TAG_KEY} disabled={saving}>
                  <XIcon />
                  Clear tag
                </ComboboxItem>
              </>
            ) : null}
          </ComboboxList>
          {!canSetTag ? (
            <ComboboxStatus>Tags are unavailable on this connection.</ComboboxStatus>
          ) : null}
          {choices.failed ? (
            <ComboboxStatus>Some thread tags could not be loaded.</ComboboxStatus>
          ) : null}
          {error ? (
            <p role="alert" className="px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </ComboboxPopup>
      </Combobox>
      {editingTag ? (
        <Dialog
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) closeEditor();
          }}
        >
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>Tag thread</DialogTitle>
              <DialogDescription>
                Set a tag for this thread. Clear the label to remove the tag.
              </DialogDescription>
            </DialogHeader>
            <ThreadTagEditor
              initialLabel={editingTag.label}
              initialColor={editingTag.color ?? null}
              onClose={closeEditor}
              onSave={(nextTag) => saveSelection(nextTag, true)}
            />
          </DialogPopup>
        </Dialog>
      ) : null}
    </>
  );
}

/** Keep row actions from selecting the tag or dismissing its containing picker. */
function TagChoiceRow({
  tag,
  selected,
  disabled,
  onOverlayOpenChange,
  onColorSave,
  onEdit,
}: {
  readonly tag: ThreadTag;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onOverlayOpenChange: (open: boolean) => void;
  readonly onColorSave: (color: string | null) => Promise<string | null>;
  readonly onEdit: () => void;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [color, setColor] = useState(tag.color ?? null);
  const menuProps = useComposerMenuProps();

  return (
    <ComboboxItem
      value={draftTagKey(tag)}
      disabled={disabled}
      onPointerDownCapture={(event) => {
        if (event.target instanceof Element && event.target.closest("button")) {
          // Cancelling pointerdown suppresses the mousedown that opens nested menus.
          event.preventBaseUIHandler();
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setActionsOpen(true);
        onOverlayOpenChange(true);
      }}
    >
      <Popover
        open={colorOpen}
        onOpenChange={(nextOpen) => {
          setColorOpen(nextOpen);
          onOverlayOpenChange(nextOpen);
          if (nextOpen) setColor(tag.color ?? null);
        }}
      >
        <PopoverTrigger
          aria-label={`Change color for ${tag.label}`}
          disabled={disabled}
          render={
            <button
              type="button"
              className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            />
          }
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onMouseUp={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <span
            aria-hidden
            className="size-2 rounded-full bg-muted-foreground"
            style={tag.color ? { backgroundColor: tag.color } : undefined}
          />
        </PopoverTrigger>
        <PopoverPopup
          align="start"
          side="right"
          width="sm"
          onClick={(event) => event.stopPropagation()}
          onMouseUp={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          {...menuProps}
        >
          <div className="grid gap-3">
            <ThreadTagColorPicker color={color} disabled={disabled} onChange={setColor} />
            <Button
              size="sm"
              disabled={disabled}
              onClick={async () => {
                if ((await onColorSave(color)) === null) {
                  setColorOpen(false);
                  onOverlayOpenChange(false);
                }
              }}
            >
              Apply color
            </Button>
          </div>
        </PopoverPopup>
      </Popover>
      <span data-tag-label className="min-w-0 flex-1 truncate">
        {tag.label}
      </span>
      {selected ? <CheckIcon className="size-3.5" /> : null}
      <Menu
        open={actionsOpen}
        onOpenChange={(nextOpen) => {
          setActionsOpen(nextOpen);
          onOverlayOpenChange(nextOpen);
        }}
      >
        <MenuTrigger
          aria-label={`Actions for tag ${tag.label}`}
          render={<Button size="icon-micro" variant="ghost-muted" disabled={disabled} />}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onMouseUp={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          ···
        </MenuTrigger>
        <MenuPopup
          align="end"
          onClick={(event) => event.stopPropagation()}
          onMouseUp={(event) => event.stopPropagation()}
          {...menuProps}
        >
          <MenuItem
            onClick={() => {
              setActionsOpen(false);
              onOverlayOpenChange(false);
              onEdit();
            }}
          >
            Rename tag...
          </MenuItem>
        </MenuPopup>
      </Menu>
    </ComboboxItem>
  );
}
