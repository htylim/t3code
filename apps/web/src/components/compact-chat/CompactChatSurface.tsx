import { scopeProjectRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  requestOlderThreadTurns,
  threadHasOlderTurns,
} from "@t3tools/client-runtime/state/threads";
import type {
  ApprovalRequestId,
  ChatAttachment,
  MessageId,
  ModelSelection,
  ProviderApprovalDecision,
  ProviderInstanceId,
  RuntimeMode,
  ProviderInteractionMode,
  ScopedThreadRef,
  ServerProvider,
  ThreadId,
  UploadChatAttachment,
} from "@t3tools/contracts";
import { applyClaudePromptEffortPrefix, resolvePromptInjectedEffort } from "@t3tools/shared/model";
import { useAtomValue } from "@effect/atom-react";
import type { LegendListRef } from "@legendapp/list/react";
import * as Option from "effect/Option";
import { ChevronDownIcon, CircleAlertIcon, MessageSquareIcon, WifiOffIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAssetUrls } from "~/assets/assetUrls";
import {
  getStartedThreadModelChangeBlockReason,
  readFileAsDataUrl,
} from "~/components/ChatView.logic";
import { type ChatComposerHandle, ChatComposer } from "~/components/chat/ChatComposer";
import { ExpandedImageDialog } from "~/components/chat/ExpandedImageDialog";
import type { ExpandedImagePreview } from "~/components/chat/ExpandedImagePreview";
import { MessagesTimeline } from "~/components/chat/MessagesTimeline";
import { ThreadErrorBanner } from "~/components/chat/ThreadErrorBanner";
import { Button } from "~/components/ui/button";
import {
  type ComposerImageAttachment,
  useComposerDraftStore,
  useComposerThreadDraft,
} from "~/composerDraftStore";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  releaseAttachmentUploads,
  startAttachmentUpload,
} from "~/lib/attachmentUploadQueue";
import { deriveLatestContextWindowSnapshot } from "~/lib/contextWindow";
import { getProviderModelCapabilities } from "~/providerModels";
import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "~/pendingUserInput";
import {
  deriveActivePlanState,
  deriveActiveWorkStartedAt,
  derivePendingApprovals,
  derivePendingUserInputs,
  derivePhase,
  deriveTimelineEntries,
  deriveTurnPlans,
  deriveWorkLogEntries,
} from "~/session-logic";
import { useEnvironment } from "~/state/environments";
import { useProject, useThread } from "~/state/entities";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { threadEnvironment, useEnvironmentThread } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import type { ChatMessage, TurnDiffSummary } from "~/types";
import { newMessageId } from "~/lib/utils";
import { resolveAppModelSelectionForInstance } from "~/modelSelection";

import {
  buildCompactChatApprovalCommand,
  buildCompactChatInterruptCommand,
  buildCompactChatStartTurnCommand,
  buildCompactChatUserInputCommand,
} from "./CompactChatSurface.logic";

interface CompactChatSurfaceProps {
  owner: ScopedThreadRef;
  target: ScopedThreadRef;
}

const EMPTY_TURN_DIFF_SUMMARIES = new Map<MessageId, TurnDiffSummary>();
const EMPTY_REVERT_COUNTS = new Map<MessageId, number>();
const SIDE_CHAT_FORK_ELIGIBILITY = {
  eligible: false,
  reason: "unsupported-environment",
  message: "Forking is not available from a side chat.",
} as const;

function commandFailureMessage(
  result: AtomCommandResult<unknown, unknown>,
  fallback: string,
): string | null {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : fallback;
}

function formatOutgoingPrompt(input: {
  provider: Parameters<typeof getProviderModelCapabilities>[2];
  model: string | null;
  models: ReadonlyArray<ServerProvider["models"][number]>;
  effort: string | null;
  text: string;
}) {
  const capabilities = getProviderModelCapabilities(input.models, input.model, input.provider);
  return applyClaudePromptEffortPrefix(
    input.text,
    resolvePromptInjectedEffort(capabilities, input.effort),
  );
}

function CompactState(props: { icon: typeof MessageSquareIcon; title: string; detail: string }) {
  const Icon = props.icon;
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
      <div className="max-w-sm">
        <Icon className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">{props.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{props.detail}</p>
      </div>
    </div>
  );
}

export function CompactChatSurface({ owner, target }: CompactChatSurfaceProps) {
  const { resolvedTheme } = useTheme();
  const environment = useEnvironment(target.environmentId);
  const threadState = useEnvironmentThread(target.environmentId, target.threadId);
  const thread = useThread(target);
  const project = useProject(
    thread ? scopeProjectRef(thread.environmentId, thread.projectId) : null,
  );
  const settings = useEnvironmentSettings(target.environmentId);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const composerDraft = useComposerThreadDraft(target);
  const setComposerDraftModelSelection = useComposerDraftStore((state) => state.setModelSelection);
  const setComposerDraftRuntimeMode = useComposerDraftStore((state) => state.setRuntimeMode);
  const setComposerDraftInteractionMode = useComposerDraftStore(
    (state) => state.setInteractionMode,
  );
  const clearComposerDraftContent = useComposerDraftStore((state) => state.clearComposerContent);
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const respondToApproval = useAtomCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const respondToUserInput = useAtomCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });

  const composerRef = useRef<ChatComposerHandle | null>(null);
  const promptRef = useRef("");
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const composerTerminalContextsRef = useRef([]);
  const composerElementContextsRef = useRef([]);
  const legendListRef = useRef<LegendListRef | null>(null);
  const sendInFlightRef = useRef(false);
  const [sending, setSending] = useState(false);
  const [sendingStartedAt, setSendingStartedAt] = useState<string | null>(null);
  const [respondingRequestIds, setRespondingRequestIds] = useState<ApprovalRequestId[]>([]);
  const [pendingInputAnswers, setPendingInputAnswers] = useState<
    Record<string, Record<string, PendingUserInputDraftAnswer>>
  >({});
  const [pendingInputQuestionIndexes, setPendingInputQuestionIndexes] = useState<
    Record<string, number>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  const [composerOverlayElement, setComposerOverlayElement] = useState<HTMLDivElement | null>(null);
  const [composerOverlayHeight, setComposerOverlayHeight] = useState(0);
  const [timelineLiveFollowEnabled, setTimelineLiveFollowEnabled] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const messages = thread?.messages ?? [];
  const activities = thread?.activities ?? [];
  const proposedPlans = thread?.proposedPlans ?? [];
  const attachmentIds = useMemo(
    () => [
      ...new Set(
        messages.flatMap((message) =>
          (message.attachments ?? []).map((attachment) => attachment.id),
        ),
      ),
    ],
    [messages],
  );
  const attachmentResources = useMemo(
    () => attachmentIds.map((attachmentId) => ({ _tag: "attachment" as const, attachmentId })),
    [attachmentIds],
  );
  const attachmentUrls = useAssetUrls(target.environmentId, attachmentResources);
  const attachmentUrlById = useMemo(
    () => new Map(attachmentIds.map((id, index) => [id, attachmentUrls[index] ?? null])),
    [attachmentIds, attachmentUrls],
  );
  const displayMessages = useMemo<ReadonlyArray<ChatMessage>>(
    () =>
      messages.map((message) => ({
        ...message,
        attachments: message.attachments?.map((attachment) => {
          const previewUrl = attachmentUrlById.get(attachment.id);
          return previewUrl ? { ...attachment, previewUrl } : attachment;
        }),
      })),
    [attachmentUrlById, messages],
  );
  const workEntries = useMemo(() => deriveWorkLogEntries(activities), [activities]);
  const turnPlans = useMemo(() => deriveTurnPlans(activities), [activities]);
  const timelineEntries = useMemo(
    () => deriveTimelineEntries(displayMessages, proposedPlans, workEntries, turnPlans),
    [displayMessages, proposedPlans, turnPlans, workEntries],
  );
  const pendingApprovals = useMemo(() => derivePendingApprovals(activities), [activities]);
  const pendingUserInputs = useMemo(() => derivePendingUserInputs(activities), [activities]);
  const activePendingApproval = pendingApprovals[0] ?? null;
  const activePendingUserInput = pendingUserInputs[0] ?? null;
  const activePendingDraftAnswers = useMemo(
    () =>
      activePendingUserInput ? (pendingInputAnswers[activePendingUserInput.requestId] ?? {}) : {},
    [activePendingUserInput, pendingInputAnswers],
  );
  const activePendingQuestionIndex = activePendingUserInput
    ? (pendingInputQuestionIndexes[activePendingUserInput.requestId] ?? 0)
    : 0;
  const activePendingProgress = useMemo(
    () =>
      activePendingUserInput
        ? derivePendingUserInputProgress(
            activePendingUserInput.questions,
            activePendingDraftAnswers,
            activePendingQuestionIndex,
          )
        : null,
    [activePendingDraftAnswers, activePendingQuestionIndex, activePendingUserInput],
  );
  const activePendingResolvedAnswers = useMemo(
    () =>
      activePendingUserInput
        ? buildPendingUserInputAnswers(activePendingUserInput.questions, activePendingDraftAnswers)
        : null,
    [activePendingDraftAnswers, activePendingUserInput],
  );

  const providerStatuses = environment?.serverConfig?.providers ?? [];
  const attachmentUploadsCapabilityKnown = environment?.serverConfig !== null;
  const supportsAttachmentUploads =
    environment?.serverConfig?.environment.capabilities.attachmentUploads === true;
  const selectedProviderStatus = thread
    ? providerStatuses.find(
        (provider) =>
          provider.instanceId ===
          (thread.session?.providerInstanceId ?? thread.modelSelection.instanceId),
      )
    : undefined;
  const connected = environment?.connection.phase === "connected";
  const isConnecting =
    environment?.connection.phase === "connecting" ||
    environment?.connection.phase === "reconnecting";
  const phase = derivePhase(thread?.session ?? null);
  const running = phase === "running";
  const runtimeMode: RuntimeMode = composerDraft.runtimeMode ?? thread?.runtimeMode ?? "auto";
  const interactionMode: ProviderInteractionMode = settings.planModeEnabled
    ? (composerDraft.interactionMode ?? thread?.interactionMode ?? "default")
    : "default";
  const activePlan = useMemo(
    () => deriveActivePlanState(activities, thread?.latestTurn?.turnId),
    [activities, thread?.latestTurn?.turnId],
  );
  const activeContextWindow = useMemo(
    () => deriveLatestContextWindowSnapshot(activities),
    [activities],
  );
  const workingStepLabel = useMemo(() => {
    if (!activePlan || activePlan.turnId !== (thread?.latestTurn?.turnId ?? null)) return null;
    return (
      activePlan.steps.find((step) => step.status === "inProgress")?.step ??
      activePlan.steps.find((step) => step.status === "pending")?.step ??
      null
    );
  }, [activePlan, thread?.latestTurn?.turnId]);
  const activeWorkStartedAt = deriveActiveWorkStartedAt(
    thread?.latestTurn ?? null,
    thread?.session ?? null,
    sendingStartedAt,
  );
  const isWorking = running || sending || isConnecting;
  const hasOlderTurns = threadHasOlderTurns(threadState);
  const loadingOlder = threadState.page._tag === "Some" && threadState.page.value.loadingOlder;
  const routeThreadKey = scopedThreadKey(target);
  const threadStateError = Option.getOrNull(threadState.error);
  const visibleError = error ?? thread?.session?.lastError ?? null;
  const environmentUnavailable =
    environment && !connected
      ? { label: environment.label, connection: environment.connection }
      : null;
  const lockedProvider = thread?.session ? (selectedProviderStatus?.driver ?? null) : null;

  useEffect(() => {
    if (!composerOverlayElement) return;
    const measure = () => setComposerOverlayHeight(composerOverlayElement.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(composerOverlayElement);
    return () => observer.disconnect();
  }, [composerOverlayElement]);

  useEffect(() => {
    setError(null);
    setTimelineLiveFollowEnabled(true);
    setShowScrollToBottom(false);
  }, [target.environmentId, target.threadId]);

  const scheduleComposerFocus = useCallback(() => {
    window.requestAnimationFrame(() => composerRef.current?.focusAtEnd());
  }, []);

  useEffect(() => {
    if (!thread?.id) return;
    scheduleComposerFocus();
  }, [scheduleComposerFocus, thread?.id]);

  const handleRuntimeModeChange = useCallback(
    (mode: RuntimeMode) => {
      setComposerDraftRuntimeMode(target, mode);
      scheduleComposerFocus();
    },
    [scheduleComposerFocus, setComposerDraftRuntimeMode, target],
  );

  const handleInteractionModeChange = useCallback(
    (mode: ProviderInteractionMode) => {
      setComposerDraftInteractionMode(target, mode);
      scheduleComposerFocus();
    },
    [scheduleComposerFocus, setComposerDraftInteractionMode, target],
  );

  const handleProviderModelSelect = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      if (!thread) return;
      const resolvedModel = resolveAppModelSelectionForInstance(
        instanceId,
        settings,
        providerStatuses,
        model,
      );
      if (!resolvedModel) return;
      const nextModelSelection: ModelSelection = { instanceId, model: resolvedModel };
      const blocked = getStartedThreadModelChangeBlockReason({
        providers: providerStatuses,
        hasStartedSession: thread.session !== null,
        currentModelSelection: thread.modelSelection,
        currentProviderInstanceId: thread.session?.providerInstanceId,
        nextModelSelection,
      });
      if (blocked) {
        setError(blocked.description);
        scheduleComposerFocus();
        return;
      }
      setComposerDraftModelSelection(target, nextModelSelection);
      scheduleComposerFocus();
    },
    [
      providerStatuses,
      scheduleComposerFocus,
      setComposerDraftModelSelection,
      settings,
      target,
      thread,
    ],
  );

  const getModelDisabledReason = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      if (!thread) return null;
      const blocked = getStartedThreadModelChangeBlockReason({
        providers: providerStatuses,
        hasStartedSession: thread.session !== null,
        currentModelSelection: thread.modelSelection,
        currentProviderInstanceId: thread.session?.providerInstanceId,
        nextModelSelection: { instanceId, model },
      });
      return blocked ? `${blocked.description} Start a new thread to use this model.` : null;
    },
    [providerStatuses, thread],
  );

  const handleInterrupt = useCallback(async () => {
    if (!thread || !connected || !running) return;
    setError(null);
    const result = await interruptTurn(
      buildCompactChatInterruptCommand({ target, session: thread.session }),
    );
    const failure = commandFailureMessage(result, "Failed to interrupt the current turn.");
    if (failure) setError(failure);
  }, [connected, interruptTurn, running, target, thread]);

  const handleApproval = useCallback(
    async (requestId: ApprovalRequestId, decision: ProviderApprovalDecision) => {
      if (!connected) return;
      setRespondingRequestIds((current) => [...new Set([...current, requestId])]);
      setError(null);
      const result = await respondToApproval(
        buildCompactChatApprovalCommand({ target, requestId, decision }),
      );
      const failure = commandFailureMessage(result, "Failed to submit approval decision.");
      if (failure) setError(failure);
      setRespondingRequestIds((current) => current.filter((id) => id !== requestId));
      return result;
    },
    [connected, respondToApproval, target],
  );

  const handleUserInput = useCallback(
    async (requestId: ApprovalRequestId, answers: Record<string, unknown>) => {
      if (!connected) return;
      setRespondingRequestIds((current) => [...new Set([...current, requestId])]);
      setError(null);
      const result = await respondToUserInput(
        buildCompactChatUserInputCommand({ target, requestId, answers }),
      );
      const failure = commandFailureMessage(result, "Failed to submit answers.");
      if (failure) setError(failure);
      setRespondingRequestIds((current) => current.filter((id) => id !== requestId));
      return result;
    },
    [connected, respondToUserInput, target],
  );

  const advancePendingUserInput = useCallback(() => {
    if (!activePendingUserInput || !activePendingProgress) return;
    if (activePendingProgress.isLastQuestion) {
      if (activePendingResolvedAnswers) {
        void handleUserInput(activePendingUserInput.requestId, activePendingResolvedAnswers);
      }
      return;
    }
    setPendingInputQuestionIndexes((current) => ({
      ...current,
      [activePendingUserInput.requestId]: activePendingProgress.questionIndex + 1,
    }));
  }, [
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingUserInput,
    handleUserInput,
  ]);

  const handleSend = useCallback(async () => {
    if (!thread || !connected || sendInFlightRef.current || running) return;
    if (activePendingProgress) {
      advancePendingUserInput();
      return;
    }
    const sendContext = composerRef.current?.getSendContext();
    if (!sendContext?.providerAvailable) return;
    const prompt = promptRef.current.trim();
    if (prompt.length === 0 && sendContext.images.length === 0) return;

    const outgoingText = formatOutgoingPrompt({
      provider: sendContext.selectedProvider,
      model: sendContext.selectedModel,
      models: sendContext.selectedProviderModels,
      effort: sendContext.selectedPromptEffort,
      text: prompt || "Describe the attached image.",
    });
    if (!composerRef.current?.validateProviderInput(outgoingText)) return;

    sendInFlightRef.current = true;
    if (supportsAttachmentUploads && sendContext.images.length > 0) {
      for (const image of sendContext.images) {
        startAttachmentUpload({ environmentId: target.environmentId, image });
      }
      await awaitAttachmentUploads(sendContext.images.map((image) => image.id));
      if (
        getUploadedAttachments({
          environmentId: target.environmentId,
          images: sendContext.images,
        }) === null
      ) {
        sendInFlightRef.current = false;
        setError("Retry or remove failed image uploads before sending.");
        return;
      }
    }
    setSending(true);
    setSendingStartedAt(new Date().toISOString());
    setError(null);
    try {
      const attachments: Array<UploadChatAttachment | ChatAttachment> = await Promise.all(
        sendContext.images.map(async (image) => {
          if (supportsAttachmentUploads) {
            const uploaded = getUploadedAttachments({
              environmentId: target.environmentId,
              images: [image],
            })?.[0];
            if (!uploaded) {
              throw new Error(`Image '${image.name}' did not finish uploading.`);
            }
            return uploaded;
          }
          return {
            type: "image" as const,
            name: image.name,
            mimeType: image.mimeType,
            sizeBytes: image.sizeBytes,
            dataUrl: await readFileAsDataUrl(image.file),
          };
        }),
      );
      const result = await startTurn(
        buildCompactChatStartTurnCommand({
          owner,
          target,
          thread,
          text: outgoingText,
          attachments,
          modelSelection: sendContext.selectedModelSelection,
          runtimeMode,
          interactionMode,
          messageId: newMessageId(),
          createdAt: new Date().toISOString(),
        }),
      );
      const failure = commandFailureMessage(result, "Failed to send message.");
      if (failure) {
        setError(failure);
      } else if (result._tag === "Success") {
        if (supportsAttachmentUploads) {
          releaseAttachmentUploads(sendContext.images);
        }
        clearComposerDraftContent(target);
        composerRef.current?.resetCursorState();
        setTimelineLiveFollowEnabled(true);
        setShowScrollToBottom(false);
        window.requestAnimationFrame(() => {
          void legendListRef.current?.scrollToEnd?.({ animated: false });
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to prepare attachments.");
    } finally {
      sendInFlightRef.current = false;
      setSending(false);
      setSendingStartedAt(null);
    }
  }, [
    activePendingProgress,
    advancePendingUserInput,
    clearComposerDraftContent,
    connected,
    interactionMode,
    owner,
    running,
    runtimeMode,
    startTurn,
    supportsAttachmentUploads,
    target,
    thread,
  ]);

  if (!environment) {
    return (
      <div data-compact-chat-surface className="flex min-h-0 flex-1 flex-col">
        <CompactState
          icon={WifiOffIcon}
          title="Environment unavailable"
          detail="This side chat is still bound to its original environment. Close it or reconnect that environment."
        />
      </div>
    );
  }

  if (threadState.status === "deleted") {
    return (
      <div data-compact-chat-surface className="flex min-h-0 flex-1 flex-col">
        <CompactState
          icon={CircleAlertIcon}
          title="Thread deleted"
          detail="The target thread no longer exists. Closing this side chat will not affect any other thread."
        />
      </div>
    );
  }

  if (!thread) {
    const unavailable = threadState.status === "live" || threadStateError !== null;
    return (
      <div data-compact-chat-surface className="flex min-h-0 flex-1 flex-col">
        <CompactState
          icon={unavailable ? CircleAlertIcon : MessageSquareIcon}
          title={unavailable ? "Thread unavailable" : "Loading thread"}
          detail={
            threadStateError ??
            (unavailable
              ? "This side chat could not load its target thread."
              : "Loading the target thread and its conversation history.")
          }
        />
      </div>
    );
  }

  return (
    <div data-compact-chat-surface className="relative flex min-h-0 flex-1 flex-col bg-background">
      {visibleError ? (
        <ThreadErrorBanner
          error={visibleError}
          {...(error !== null ? { onDismiss: () => setError(null) } : {})}
        />
      ) : null}

      <div className="relative min-h-0 flex-1">
        <MessagesTimeline
          key={routeThreadKey}
          isWorking={isWorking}
          workingStepLabel={workingStepLabel}
          activeTurnStartedAt={activeWorkStartedAt}
          listRef={legendListRef}
          timelineEntries={timelineEntries}
          latestTurn={thread.latestTurn}
          runningTurnId={thread.session?.status === "running" ? thread.session.activeTurnId : null}
          turnDiffSummaryByAssistantMessageId={EMPTY_TURN_DIFF_SUMMARIES}
          routeThreadKey={routeThreadKey}
          onOpenTurnDiff={() => {}}
          revertTurnCountByUserMessageId={EMPTY_REVERT_COUNTS}
          onRevertUserMessage={() => {}}
          isRevertingCheckpoint={false}
          onImageExpand={setExpandedImage}
          activeThreadEnvironmentId={target.environmentId}
          markdownCwd={thread.worktreePath ?? project?.workspaceRoot ?? undefined}
          resolvedTheme={resolvedTheme}
          timestampFormat={settings.timestampFormat}
          workspaceRoot={project?.workspaceRoot}
          skills={selectedProviderStatus?.skills ?? []}
          anchorMessageId={null}
          onAnchorReady={() => {}}
          contentInsetEndAdjustment={composerOverlayHeight}
          liveFollowEnabled={timelineLiveFollowEnabled}
          onIsAtEndChange={(isAtEnd) => {
            setTimelineLiveFollowEnabled(isAtEnd);
            setShowScrollToBottom(!isAtEnd);
          }}
          onManualNavigation={() => setTimelineLiveFollowEnabled(false)}
          topFadeEnabled={false}
          loadEarlier={
            hasOlderTurns
              ? {
                  loading: loadingOlder,
                  onLoadEarlier: () =>
                    requestOlderThreadTurns(target.environmentId, target.threadId),
                }
              : null
          }
        />

        {showScrollToBottom ? (
          <div
            className="pointer-events-none absolute left-1/2 z-30 flex -translate-x-1/2 justify-center py-1.5"
            style={{ bottom: composerOverlayHeight + 4 }}
          >
            <Button
              aria-label="Scroll to end"
              className="pointer-events-auto gap-1.5 rounded-full px-3 text-muted-foreground hover:text-foreground"
              size="xs"
              variant="glass"
              onClick={() => {
                setTimelineLiveFollowEnabled(true);
                setShowScrollToBottom(false);
                void legendListRef.current?.scrollToEnd?.({ animated: true });
              }}
            >
              <ChevronDownIcon className="size-3.5" />
              Scroll to end
            </Button>
          </div>
        ) : null}
      </div>

      <div
        ref={setComposerOverlayElement}
        data-chat-composer-overlay="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 pt-1.5 sm:pt-2"
      >
        <div className="w-full px-3 sm:px-5">
          <div className="pointer-events-auto relative z-10">
            <div className="chat-composer-glass-shell relative mx-auto w-full max-w-3xl">
              <div className="chat-composer-glass-host relative z-10 w-full rounded-[22px]">
                <ChatComposer
                  composerRef={composerRef}
                  composerDraftTarget={target}
                  environmentId={target.environmentId}
                  attachmentUploadsCapabilityKnown={attachmentUploadsCapabilityKnown}
                  supportsAttachmentUploads={supportsAttachmentUploads}
                  routeKind="server"
                  routeThreadRef={target}
                  draftId={null}
                  activeThreadId={thread.id}
                  activeThreadEnvironmentId={thread.environmentId}
                  activeThread={thread}
                  isServerThread
                  isLocalDraftThread={false}
                  forceExpandedOnMobile={false}
                  projectSelectionRequired={false}
                  phase={phase}
                  isConnecting={isConnecting}
                  isSendBusy={sending}
                  sendBusyLabel="Sending"
                  sendDisabledReason={null}
                  isPreparingWorktree={false}
                  externalDrawerAttached={false}
                  environmentUnavailable={environmentUnavailable}
                  activePendingApproval={activePendingApproval}
                  pendingApprovals={pendingApprovals}
                  pendingUserInputs={pendingUserInputs}
                  activePendingProgress={activePendingProgress}
                  activePendingResolvedAnswers={activePendingResolvedAnswers}
                  activePendingIsResponding={
                    activePendingUserInput
                      ? respondingRequestIds.includes(activePendingUserInput.requestId)
                      : false
                  }
                  activePendingDraftAnswers={activePendingDraftAnswers}
                  activePendingQuestionIndex={activePendingQuestionIndex}
                  respondingRequestIds={respondingRequestIds}
                  showPlanFollowUpPrompt={false}
                  activeProposedPlan={null}
                  activeTasksProgress={null}
                  activeTaskSteps={null}
                  runtimeMode={runtimeMode}
                  interactionMode={interactionMode}
                  lockedProvider={lockedProvider}
                  providerStatuses={providerStatuses as ServerProvider[]}
                  activeProjectDefaultModelSelection={project?.defaultModelSelection}
                  activeThreadModelSelection={thread.modelSelection}
                  activeContextWindow={activeContextWindow}
                  compactDisabled
                  compactDisabledReason="Compacting is not available from a side chat."
                  resolvedTheme={resolvedTheme}
                  settings={settings}
                  keybindings={keybindings}
                  terminalOpen={false}
                  gitCwd={thread.worktreePath ?? project?.workspaceRoot ?? null}
                  forkEligibility={SIDE_CHAT_FORK_ELIGIBILITY}
                  promptRef={promptRef}
                  composerImagesRef={composerImagesRef}
                  composerTerminalContextsRef={composerTerminalContextsRef}
                  composerElementContextsRef={composerElementContextsRef}
                  onSend={(event) => {
                    event?.preventDefault();
                    void handleSend();
                  }}
                  onInterrupt={() => void handleInterrupt()}
                  onImplementPlanInNewThread={() => {}}
                  onRespondToApproval={handleApproval}
                  onSelectActivePendingUserInputOption={(questionId, optionLabel) => {
                    if (!activePendingUserInput) return;
                    const question = activePendingUserInput.questions.find(
                      (candidate) => candidate.id === questionId,
                    );
                    if (!question) return;
                    setPendingInputAnswers((current) => ({
                      ...current,
                      [activePendingUserInput.requestId]: {
                        ...current[activePendingUserInput.requestId],
                        [questionId]: togglePendingUserInputOptionSelection(
                          question,
                          current[activePendingUserInput.requestId]?.[questionId],
                          optionLabel,
                        ),
                      },
                    }));
                    promptRef.current = "";
                    composerRef.current?.resetCursorState({ cursor: 0 });
                  }}
                  onAdvanceActivePendingUserInput={advancePendingUserInput}
                  onPreviousActivePendingUserInputQuestion={() => {
                    if (!activePendingUserInput || !activePendingProgress) return;
                    setPendingInputQuestionIndexes((current) => ({
                      ...current,
                      [activePendingUserInput.requestId]: Math.max(
                        activePendingProgress.questionIndex - 1,
                        0,
                      ),
                    }));
                  }}
                  onChangeActivePendingUserInputCustomAnswer={(questionId, value) => {
                    if (!activePendingUserInput) return;
                    promptRef.current = value;
                    setPendingInputAnswers((current) => ({
                      ...current,
                      [activePendingUserInput.requestId]: {
                        ...current[activePendingUserInput.requestId],
                        [questionId]: setPendingUserInputCustomAnswer(
                          current[activePendingUserInput.requestId]?.[questionId],
                          value,
                        ),
                      },
                    }));
                  }}
                  onProviderModelSelect={handleProviderModelSelect}
                  getModelDisabledReason={getModelDisabledReason}
                  toggleInteractionMode={() =>
                    handleInteractionModeChange(interactionMode === "plan" ? "default" : "plan")
                  }
                  handleRuntimeModeChange={handleRuntimeModeChange}
                  handleInteractionModeChange={handleInteractionModeChange}
                  focusComposer={() => composerRef.current?.focusAtEnd()}
                  scheduleComposerFocus={scheduleComposerFocus}
                  setThreadError={(threadId: ThreadId | null, nextError: string | null) => {
                    if (threadId === null || threadId === target.threadId) setError(nextError);
                  }}
                  onExpandImage={setExpandedImage}
                />
              </div>
            </div>
          </div>
          <div
            aria-hidden
            data-side-chat-composer-footer-spacer
            className="h-[calc(env(safe-area-inset-bottom)+3rem)] sm:h-[calc(env(safe-area-inset-bottom)+3.25rem)]"
          />
        </div>
      </div>

      {expandedImage ? (
        <ExpandedImageDialog
          key={`${expandedImage.images[expandedImage.index]?.src ?? "image"}:${expandedImage.index}`}
          preview={expandedImage}
          onClose={() => setExpandedImage(null)}
        />
      ) : null}
    </div>
  );
}
