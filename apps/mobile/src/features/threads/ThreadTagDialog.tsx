import { useAtomValue } from "@effect/atom-react";
import { THREAD_TAG_LABEL_MAX_LENGTH, type ScopedThreadRef } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { THREAD_TAG_COLOR_PRESETS } from "@t3tools/client-runtime/thread-tag-colors";
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
            Clear the label to remove the tag.
          </AppText>
          {snapshot !== null && allowed ? (
            <ThreadTagForm
              threadRef={threadRef}
              initialLabel={snapshot[threadRef.threadId]?.label ?? ""}
              initialColor={snapshot[threadRef.threadId]?.color ?? null}
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
  initialColor,
  onClose,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly initialLabel: string;
  readonly initialColor: string | null;
  readonly onClose: () => void;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [color, setColor] = useState(initialColor);
  const [customColorOpen, setCustomColorOpen] = useState(false);
  const [customColorDraft, setCustomColorDraft] = useState(initialColor ?? "");
  const invalidCustomColor =
    customColorOpen && customColorDraft !== "" && !/^#[0-9a-f]{6}$/i.test(customColorDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setTag = useAtomCommand(threadTagEnvironment.set, { reportFailure: false });

  /** Send the override to the thread's host, then dismiss after persistence succeeds. */
  async function saveTag(nextLabel: string): Promise<void> {
    if (saving || (nextLabel.trim() && invalidCustomColor)) return;
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
      <AppText className="mt-4 text-sm font-t3-medium">Tag color</AppText>
      <View className="mt-2 flex-row flex-wrap items-center gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: color === null, disabled: saving }}
          disabled={saving}
          onPress={() => {
            setColor(null);
            setCustomColorDraft("");
          }}
          className="min-h-10 justify-center rounded-xl border border-border px-3"
        >
          <AppText>Default</AppText>
        </Pressable>
        {THREAD_TAG_COLOR_PRESETS.map((preset) => (
          <Pressable
            key={preset.color}
            accessibilityRole="button"
            accessibilityLabel={`${preset.label} tag color`}
            accessibilityState={{
              selected: color?.toLowerCase() === preset.color,
              disabled: saving,
            }}
            disabled={saving}
            onPress={() => {
              setColor(preset.color);
              setCustomColorDraft(preset.color);
            }}
            className="size-10 items-center justify-center rounded-full border border-border"
            style={{ backgroundColor: preset.color }}
          >
            {color?.toLowerCase() === preset.color ? (
              <AppText style={{ color: "#ffffff" }}>✓</AppText>
            ) : null}
          </Pressable>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: customColorOpen, disabled: saving }}
        disabled={saving}
        onPress={() => setCustomColorOpen(!customColorOpen)}
        className="mt-2 min-h-10 justify-center"
      >
        <AppText>Custom color</AppText>
      </Pressable>
      {customColorOpen ? (
        <>
          <TextInput
            accessibilityLabel="Custom tag hex color"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={7}
            placeholder="#8b5cf6"
            value={customColorDraft}
            editable={!saving}
            onChangeText={(hexColor) => {
              setCustomColorDraft(hexColor);
              if (hexColor === "") setColor(null);
              else if (/^#[0-9a-f]{6}$/i.test(hexColor)) setColor(hexColor.toLowerCase());
            }}
            className="rounded-xl border border-border bg-screen px-3 py-2.5 text-base text-foreground"
          />
          {invalidCustomColor ? (
            <AppText className="mt-2 text-sm text-danger-foreground">
              Enter a six-digit hex color, such as #8b5cf6.
            </AppText>
          ) : null}
        </>
      ) : null}
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
          disabled={saving || invalidCustomColor}
          onPress={() => void saveTag(label)}
          className="min-h-10 justify-center"
        >
          <AppText>{saving ? "Saving..." : "Save"}</AppText>
        </Pressable>
      </View>
    </>
  );
}
