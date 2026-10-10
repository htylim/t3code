import { useAtomValue } from "@effect/atom-react";
import { THREAD_TAG_LABEL_MAX_LENGTH, type ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useId, useState } from "react";
import { create } from "zustand";
import { threadTagEnvironment } from "../state/threadTags";
import { useAtomCommand } from "../state/use-atom-command";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { ThreadTagColorPicker } from "./ThreadTagColorPicker";
import { ThreadTagPill } from "./ThreadTagPill";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "./ui/dialog";

type TagRequest = { readonly threadRef: ScopedThreadRef };
const useTagRequest = create<{ request: TagRequest | null }>(() => ({ request: null }));

/** Open the shared editor from a tag pill, menu, command palette, or keyboard shortcut. */
export function requestThreadTag(threadRef: ScopedThreadRef): void {
  useTagRequest.setState({ request: { threadRef } });
}

/** Clear the current request when the editor closes or successfully saves. */
function closeThreadTagDialog(request: TagRequest): void {
  if (useTagRequest.getState().request === request) useTagRequest.setState({ request: null });
}

/** Mount one editor above every chat layout, including responsive and legacy sidebars. */
export function ThreadTagDialogHost() {
  const request = useTagRequest((state) => state.request);
  return request ? (
    <ThreadTagDialog key={scopedThreadKey(request.threadRef)} request={request} />
  ) : null;
}

/** Wait for the server snapshot before editing, so loading cannot erase an existing tag. */
function ThreadTagDialog({ request }: { request: TagRequest }) {
  const { threadRef } = request;
  const snapshot = useAtomValue(threadTagEnvironment.snapshotAtom(threadRef.environmentId));
  const failed = useAtomValue(threadTagEnvironment.failedAtom(threadRef.environmentId));
  const supported = useAtomValue(threadTagEnvironment.supportedAtom(threadRef.environmentId));
  const allowed = useAtomValue(threadTagEnvironment.set.permissionAtom(threadRef.environmentId));
  let statusMessage = "Loading thread tag...";
  if (!supported || !allowed) statusMessage = "Thread tags are unavailable on this connection.";
  else if (failed) statusMessage = "Failed to load thread tags. Reconnect and try again.";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeThreadTagDialog(request);
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Tag thread</DialogTitle>
          <DialogDescription>
            Set a tag for this thread. Clear the label to remove the tag.
          </DialogDescription>
        </DialogHeader>
        {snapshot !== null && supported && allowed ? (
          <ThreadTagForm
            threadRef={threadRef}
            initialLabel={snapshot[threadRef.threadId]?.label ?? ""}
            initialColor={snapshot[threadRef.threadId]?.color ?? null}
            onClose={() => closeThreadTagDialog(request)}
          />
        ) : (
          <DialogPanel>
            <p role="status">{statusMessage}</p>
            <Button variant="outline" onClick={() => closeThreadTagDialog(request)}>
              Close
            </Button>
          </DialogPanel>
        )}
      </DialogPopup>
    </Dialog>
  );
}

/** Keep a failed save open with the entered label intact. Empty input removes the override. */
function ThreadTagForm({
  threadRef,
  initialLabel,
  initialColor,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  initialLabel: string;
  initialColor: string | null;
  onClose: () => void;
}) {
  const inputId = useId();
  const [label, setLabel] = useState(initialLabel);
  const [color, setColor] = useState(initialColor);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setTag = useAtomCommand(threadTagEnvironment.set, { reportFailure: false });

  /** Close only after the destination server commits the label or removal. */
  async function saveTag(nextLabel: string): Promise<void> {
    if (saving) return;
    setSaving(true);
    setError(null);
    const trimmedLabel = nextLabel.trim();
    const saved = await setTag({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        tag: trimmedLabel ? { label: trimmedLabel, color } : null,
      },
    });
    setSaving(false);
    if (saved._tag === "Success") onClose();
    else {
      const failure = squashAtomCommandFailure(saved);
      setError(failure instanceof Error ? failure.message : "Failed to save thread tag.");
    }
  }

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void saveTag(label);
      }}
    >
      <DialogPanel>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={inputId}>Thread tag</Label>
            <Input
              id={inputId}
              autoFocus
              maxLength={THREAD_TAG_LABEL_MAX_LENGTH}
              placeholder="e.g. v3 refactor"
              value={label}
              disabled={saving}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <ThreadTagColorPicker color={color} disabled={saving} onChange={setColor} />
          <div className="grid gap-2">
            <span className="text-xs text-muted-foreground">Preview</span>
            <div className="min-w-0">
              <ThreadTagPill label={label.trim() || "Thread tag"} color={color} />
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </DialogPanel>
      <DialogFooter>
        {initialLabel ? (
          <Button type="button" variant="ghost" disabled={saving} onClick={() => void saveTag("")}>
            Clear tag
          </Button>
        ) : null}
        <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
