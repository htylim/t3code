import { useAtomValue } from "@effect/atom-react";
import { THREAD_TAG_LABEL_MAX_LENGTH, type ScopedThreadRef } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { Modal, Pressable, TextInput, View } from "react-native";
import { AppText } from "../../components/AppText";
import { threadTagEnvironment } from "../../state/thread-tags";
import { useAtomCommand } from "../../state/use-atom-command";

/** Edit one environment-owned label on either native platform. Empty input clears it. */
export function ThreadTagDialog({
  threadRef,
  onClose,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly onClose: () => void;
}) {
  const snapshot = useAtomValue(threadTagEnvironment.snapshotAtom(threadRef.environmentId));
  const failed = useAtomValue(threadTagEnvironment.failedAtom(threadRef.environmentId));
  const allowed = useAtomValue(threadTagEnvironment.set.permissionAtom(threadRef.environmentId));
  let statusMessage = "Loading thread tag...";
  if (!allowed) statusMessage = "Thread tags are unavailable.";
  else if (failed) statusMessage = "Failed to load thread tags.";
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-backdrop px-8">
        <View className="w-full rounded-[24px] bg-card px-6 pb-4 pt-5">
          <AppText className="text-lg font-t3-medium">Tag thread</AppText>
          <AppText className="mt-2 text-sm text-foreground-secondary">
            Clear the label to use the project name.
          </AppText>
          {snapshot !== null && allowed ? (
            <ThreadTagForm
              threadRef={threadRef}
              initialLabel={snapshot[threadRef.threadId]?.label ?? ""}
              onClose={onClose}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              className="min-h-10 justify-center"
              onPress={onClose}
            >
              <AppText>
                {statusMessage}
                Close
              </AppText>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

/** Keep the label draft and any persistence error visible until saving succeeds. */
function ThreadTagForm({
  threadRef,
  initialLabel,
  onClose,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly initialLabel: string;
  readonly onClose: () => void;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setTag = useAtomCommand(threadTagEnvironment.set, { reportFailure: false });

  /** Send the override to the thread's host, then dismiss after persistence succeeds. */
  async function saveTag(nextLabel: string): Promise<void> {
    if (saving) return;
    setSaving(true);
    setError(null);
    const trimmedLabel = nextLabel.trim();
    const saved = await setTag({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        tag: trimmedLabel ? { label: trimmedLabel } : null,
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
    <>
      <TextInput
        accessibilityLabel="Thread tag"
        autoFocus
        maxLength={THREAD_TAG_LABEL_MAX_LENGTH}
        placeholder="e.g. v3 refactor"
        value={label}
        onChangeText={setLabel}
        editable={!saving}
        onSubmitEditing={() => void saveTag(label)}
        returnKeyType="done"
        className="mt-4 rounded-xl border border-border bg-screen px-3 py-2.5 text-base text-foreground"
      />
      {error ? (
        <AppText accessibilityRole="alert" className="mt-2 text-sm text-danger-foreground">
          {error}
        </AppText>
      ) : null}
      <View className="mt-5 flex-row justify-end gap-3">
        {initialLabel ? (
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={() => void saveTag("")}
            className="min-h-10 justify-center"
          >
            <AppText>Clear tag</AppText>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={onClose}
          className="min-h-10 justify-center"
        >
          <AppText>Cancel</AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={() => void saveTag(label)}
          className="min-h-10 justify-center"
        >
          <AppText>{saving ? "Saving..." : "Save"}</AppText>
        </Pressable>
      </View>
    </>
  );
}
