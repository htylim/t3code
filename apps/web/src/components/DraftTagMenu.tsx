import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ScopedThreadRef, ThreadTags } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { CheckIcon, PlusIcon, TagIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
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

/** Offer the writable draft picker, retaining Clear tag when the destination changes. */
export function DraftTagMenu({
  draftId,
  threadRef,
}: {
  readonly draftId?: DraftId | undefined;
  readonly threadRef: ScopedThreadRef;
}) {
  const resolvedDraftId = useComposerDraftStore(
    (state) => draftId ?? state.getDraftIdByRef(threadRef),
  );
  const supported = useAtomValue(threadTagEnvironment.supportedAtom(threadRef.environmentId));
  const allowed = useAtomValue(threadTagEnvironment.set.permissionAtom(threadRef.environmentId));
  const selectedTag = useDraftTagStore((state) =>
    resolvedDraftId ? state.byDraftId[resolvedDraftId] : undefined,
  );
  if (!resolvedDraftId || ((!supported || !allowed) && !selectedTag)) return null;
  return (
    <DraftTagPicker
      key={resolvedDraftId}
      draftId={resolvedDraftId}
      canSetTag={supported && allowed}
    />
  );
}

/** Match the workspace control, with a soft selected pill and plain dot-and-label choices. */
function DraftTagPicker({
  draftId,
  canSetTag,
}: {
  readonly draftId: DraftId;
  readonly canSetTag: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const tag = useDraftTagStore((state) => state.byDraftId[draftId] ?? null);
  const choices = useActiveTagChoices(open && canSetTag);
  const menuProps = useComposerMenuProps();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredTags = choices.tags.filter((choice) =>
    choice.label.toLocaleLowerCase().includes(normalizedQuery),
  );
  const keys = filteredTags.map(draftTagKey);
  if (canSetTag) keys.push(NEW_TAG_KEY);
  if (tag) keys.push(CLEAR_TAG_KEY);
  const selectedKey = tag ? draftTagKey(tag) : null;
  const select = useDraftTagStore((state) => state.select);
  let emptyMessage = "No tags on active threads.";
  if (choices.loading) emptyMessage = "Loading tags...";
  else if (choices.failed) emptyMessage = "Tags could not be loaded.";
  else if (normalizedQuery) emptyMessage = "No matching tags.";

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
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setQuery("");
        }}
        onValueChange={(key) => {
          if (key === NEW_TAG_KEY) {
            setNewLabel(query.trim());
            setCreating(true);
          } else if (key === CLEAR_TAG_KEY) select(draftId, null);
          else {
            const choice = filteredTags.find((candidate) => draftTagKey(candidate) === key);
            if (choice) select(draftId, choice);
          }
        }}
      >
        <ComboboxTrigger
          render={<ComposerControl size="xs" />}
          aria-label={`Draft tag: ${tag?.label ?? "No Tag"}`}
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
          <ComboboxSearchInput aria-label="Search tags" placeholder="Search tags..." />
          <ComboboxStatus>
            {canSetTag
              ? "Active, postponed, and snoozed"
              : "Tags are unavailable on this connection."}
          </ComboboxStatus>
          <ComboboxList>
            {filteredTags.map((choice) => (
              <ComboboxItem key={draftTagKey(choice)} value={draftTagKey(choice)}>
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full bg-muted-foreground"
                  style={choice.color ? { backgroundColor: choice.color } : undefined}
                />
                <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                {draftTagKey(choice) === selectedKey ? <CheckIcon className="size-3.5" /> : null}
              </ComboboxItem>
            ))}
            {filteredTags.length === 0 && canSetTag ? (
              <p role="status" className="px-2 py-1 text-sm text-muted-foreground">
                {emptyMessage}
              </p>
            ) : null}
            <div className="py-1">
              <Separator />
            </div>
            {canSetTag ? (
              <ComboboxItem value={NEW_TAG_KEY}>
                <PlusIcon />
                New tag...
              </ComboboxItem>
            ) : null}
            {tag ? (
              <ComboboxItem value={CLEAR_TAG_KEY}>
                <XIcon />
                Clear tag
              </ComboboxItem>
            ) : null}
          </ComboboxList>
          {choices.failed ? (
            <ComboboxStatus>Some thread tags could not be loaded.</ComboboxStatus>
          ) : null}
        </ComboboxPopup>
      </Combobox>
      {creating ? (
        <Dialog open onOpenChange={setCreating}>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>New tag</DialogTitle>
              <DialogDescription>Choose a label and color for this draft.</DialogDescription>
            </DialogHeader>
            <ThreadTagEditor
              initialLabel={newLabel}
              initialColor={null}
              requireLabel
              submitLabel="Use tag"
              onClose={() => setCreating(false)}
              onSave={async (nextTag) => {
                if (!canSetTag) return "Tags are unavailable on this connection.";
                select(draftId, nextTag);
                return null;
              }}
            />
          </DialogPopup>
        </Dialog>
      ) : null}
    </>
  );
}
