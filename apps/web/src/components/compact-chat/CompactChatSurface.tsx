import { useNavigate } from "@tanstack/react-router";
import { buildThreadRouteParams } from "~/threadRoutes";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { derivePendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import type {
  RuntimeRequestId,
  ChatAttachment,
  ModelSelection,
  ProviderApprovalDecision,
  ProviderInstanceId,
  RuntimeMode,
  ProviderInteractionMode,
  ScopedThreadRef,
  ServerProvider,
  ThreadId,
  UploadChatAttachment,
  UserInputAttachments,
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
import { ComposerSurface } from "~/components/chat/ComposerSurface";
import { ExpandedImageDialog } from "~/components/chat/ExpandedImageDialog";
import type { ExpandedImagePreview } from "~/components/chat/ExpandedImagePreview";
import { MessagesTimeline } from "~/components/chat/MessagesTimeline";
import { ThreadErrorBanner } from "~/components/chat/ThreadErrorBanner";
import { Button } from "~/components/ui/button";
import {
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  useComposerDraftStore,
  DraftId,
  useComposerThreadDraft,
} from "~/composerDraftStore";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  releaseDraftAttachments,
  startAttachmentUpload,
  useAttachmentUploadStore,
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
  deriveActiveWorkStartedAt,
  derivePhase,
  deriveTimelineEntriesFromVisibleTurnItems,
  derivePendingApprovals,
  derivePendingUserInputs,
} from "~/session-logic";
import { useEnvironment } from "~/state/environments";
import {
  useProject,
  useThreadProjection,
  useThreadShell,
  useThreadHistory,
  useThreadVisibleTurnItems,
  waitForThreadShell,
} from "~/state/entities";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { threadEnvironment, useEnvironmentThread } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { newMessageId, newThreadId } from "~/lib/utils";
import { resolveAppModelSelectionForInstance } from "~/modelSelection";
import {
  createPageScrollController,
  type PageScrollKey,
} from "~/components/chat/pageScrollController";
import { useRightPanelStore } from "~/rightPanelStore";
import { resolveShortcutCommand } from "~/keybindings";
import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { useShallow } from "zustand/react/shallow";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { serializeLegacyContextMessage } from "@t3tools/shared/composerContextLegacySend";
import { buildMessageContext, terminalContextReference } from "~/lib/composerContextRecords";
import { filterTerminalContextsWithText } from "~/lib/terminalContext";
import { removeInlineContextReference } from "~/lib/composerContextReferences";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentServerConfigsAtom } from "~/state/server";
import {
  questionAttachmentDraftId,
  questionAttachmentDraftPrefix,
  clearQuestionAttachmentDraft,
  useQuestionAttachmentPreparation,
} from "~/questionAttachments";

import {
  buildCompactChatApprovalCommand,
  buildCompactChatInterruptCommand,
  buildCompactChatStartTurnCommand,
  buildCompactChatUserInputCommand,
} from "./CompactChatSurface.logic";

interface CompactChatSurfaceProps {
  owner: ScopedThreadRef;
  target: ScopedThreadRef;
  /** Changes when a selection action has updated this target's draft. */
  focusRequestId: number;
}

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

export function CompactChatSurface({ owner, target, focusRequestId }: CompactChatSurfaceProps) {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const environment = useEnvironment(target.environmentId);
  const threadState = useEnvironmentThread(target.environmentId, target.threadId);
  const threadProjection = useThreadProjection(target)?.projection ?? null;
  const thread = useThreadShell(target);
  const threadHistory = useThreadHistory(target);
  const visibleTurnItems = useThreadVisibleTurnItems(target);
  const loadEarlierHistory = useAtomCommand(threadEnvironment.loadEarlierHistory);
  const threadShell = useThreadShell(target);
  const project = useProject(
    thread ? scopeProjectRef(thread.environmentId, thread.projectId) : null,
  );
  const settings = useEnvironmentSettings(target.environmentId);
  const projectSettings = resolveProjectSettings(
    settings,
    thread?.projectId ?? null,
    project ?? undefined,
  ).settings;
  const supportsQuestionAttachments =
    environment?.serverConfig?.environment.capabilities.questionAttachments === true;
  const supportsPullRequests =
    environment?.serverConfig?.environment.capabilities.pullRequests === true;
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const composerDraft = useComposerThreadDraft(target);
  const setComposerDraftModelSelection = useComposerDraftStore((state) => state.setModelSelection);
  const setComposerDraftRuntimeMode = useComposerDraftStore((state) => state.setRuntimeMode);
  const setComposerDraftInteractionMode = useComposerDraftStore(
    (state) => state.setInteractionMode,
  );
  const clearComposerDraftContent = useComposerDraftStore((state) => state.clearComposerContent);
  const forkFromRun = useAtomCommand(threadEnvironment.forkFromRun, { reportFailure: false });
  const revertCheckpoint = useAtomCommand(threadEnvironment.revertCheckpoint, {
    reportFailure: false,
  });
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const respondToApproval = useAtomCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const respondToUserInput = useAtomCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });

  const dismissUserInput = useAtomCommand(threadEnvironment.dismissUserInput, {
    reportFailure: false,
  });
  const userInputInFlight = useRef(new Set<RuntimeRequestId>());
  const composerRef = useRef<ChatComposerHandle | null>(null);
  const promptRef = useRef("");
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const composerFilesRef = useRef<ComposerFileAttachment[]>([]);
  const composerTerminalContextsRef = useRef([]);
  const legendListRef = useRef<LegendListRef | null>(null);
  const sendInFlightRef = useRef(false);
  const [sending, setSending] = useState(false);
  const [sendingStartedAt, setSendingStartedAt] = useState<string | null>(null);
  const [respondingRequestIds, setRespondingRequestIds] = useState<RuntimeRequestId[]>([]);
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
  const [timelineOverflows, setTimelineOverflows] = useState(false);

  const messages = threadProjection?.messages ?? [];

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
    () =>
      new Map(
        attachmentIds.flatMap((id, index) => {
          const url = attachmentUrls[index];
          return url ? [[id, url] as const] : [];
        }),
      ),
    [attachmentIds, attachmentUrls],
  );
  const timelineEntries = useMemo(
    () =>
      deriveTimelineEntriesFromVisibleTurnItems({
        visibleTurnItems,
        optimisticMessages: [],
        attachmentUrlById,
        ...(threadProjection
          ? {
              attempts: threadProjection.attempts,
              nodes: threadProjection.nodes,
              plans: threadProjection.plans,
            }
          : {}),
      }),
    [visibleTurnItems, attachmentUrlById, threadProjection],
  );
  const { approvals: pendingApprovals, userInputs: pendingUserInputs } = useMemo(() => {
    const requests = threadProjection
      ? derivePendingThreadRequests(threadProjection)
      : { approvals: [], userInputs: [] };
    return {
      approvals: derivePendingApprovals(requests.approvals),
      userInputs: derivePendingUserInputs(requests.userInputs),
    };
  }, [threadProjection]);
  const activePendingApproval = pendingApprovals[0] ?? null;
  const activePendingUserInput = pendingUserInputs[0] ?? null;
  const pendingQuestionDraftKeys = useMemo(
    () =>
      target.threadId
        ? pendingUserInputs.flatMap((request) =>
            request.questions.map((question) =>
              questionAttachmentDraftId(
                target.environmentId,
                target.threadId,
                request.requestId,
                question.id,
              ),
            ),
          )
        : [],
    [target.threadId, target.environmentId, pendingUserInputs],
  );
  const questionComposerDrafts = useComposerDraftStore(
    useShallow((state) =>
      Object.fromEntries(
        pendingQuestionDraftKeys.map((key) => [key, state.draftsByThreadKey[key]]),
      ),
    ),
  );
  const questionUploadsBlocked = useAttachmentUploadStore(
    useShallow((state) =>
      Object.fromEntries(
        pendingQuestionDraftKeys.map((key) => {
          const draft = questionComposerDrafts[key];
          const attachments = draft ? [...draft.images, ...draft.files] : [];
          return [
            key,
            attachments.some((attachment) => {
              const upload = state.uploadsByImageId[attachment.id];
              return upload?.status !== "ready" || upload.environmentId !== target.environmentId;
            }),
          ];
        }),
      ),
    ),
  );
  const questionPreparations = useQuestionAttachmentPreparation(
    useShallow((state) =>
      Object.fromEntries(pendingQuestionDraftKeys.map((key) => [key, state.counts[key] ?? 0])),
    ),
  );
  useEffect(() => {
    if (threadState.status !== "live" || threadState.data._tag !== "Some") return;
    const questionThread = threadState.data.value;
    const { userInputs: currentRequests } = derivePendingThreadRequests(questionThread);
    const prefix = questionAttachmentDraftPrefix(target.environmentId, questionThread.thread.id);
    const retained = new Set(
      currentRequests.flatMap((request) =>
        request.questions.map((question) =>
          questionAttachmentDraftId(
            target.environmentId,
            questionThread.thread.id,
            request.requestId,
            question.id,
          ),
        ),
      ),
    );
    const keys = new Set([
      ...Object.keys(useComposerDraftStore.getState().draftsByThreadKey),
      ...Object.keys(useQuestionAttachmentPreparation.getState().counts),
    ]);
    for (const key of keys) {
      if (key.startsWith(prefix) && !retained.has(DraftId.make(key)))
        clearQuestionAttachmentDraft(DraftId.make(key));
    }
  }, [target.environmentId, threadState.data, threadState.status]);
  const activePendingDraftAnswers = useMemo(() => {
    if (!activePendingUserInput || !target.threadId) return {};
    return Object.fromEntries(
      activePendingUserInput.questions.map((question) => {
        const key = questionAttachmentDraftId(
          target.environmentId,
          target.threadId,
          activePendingUserInput.requestId,
          question.id,
        );
        const draft = questionComposerDrafts[key];
        const attachments = draft ? [...draft.images, ...draft.files] : [];
        return [
          question.id,
          {
            ...pendingInputAnswers[activePendingUserInput.requestId]?.[question.id],
            attachmentCount: attachments.length,
            attachmentsBlocked:
              (attachments.length > 0 && !supportsQuestionAttachments) ||
              (questionPreparations[key] ?? 0) > 0 ||
              questionUploadsBlocked[key] === true,
          },
        ];
      }),
    );
  }, [
    activePendingUserInput,
    target.threadId,
    target.environmentId,
    questionComposerDrafts,
    questionUploadsBlocked,
    supportsQuestionAttachments,
    questionPreparations,
    pendingInputAnswers,
  ]);
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
  const maxFileAttachmentBytes =
    environment?.serverConfig?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null;
  const selectedProviderStatus = thread
    ? providerStatuses.find(
        (provider) =>
          provider.instanceId ===
          (thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId),
      )
    : undefined;
  const connected = environment?.connection.phase === "connected";
  const isConnecting =
    environment?.connection.phase === "connecting" ||
    environment?.connection.phase === "reconnecting";
  const phase = derivePhase(thread?.runtime ?? null);
  const running = phase === "running";
  const runtimeMode: RuntimeMode =
    composerDraft.runtimeMode ?? thread?.runtimeMode ?? projectSettings.defaultRuntimeMode;
  const interactionMode: ProviderInteractionMode = settings.planModeEnabled
    ? (composerDraft.interactionMode ?? thread?.interactionMode ?? "default")
    : "default";
  const activeContextWindow = useMemo(
    () => deriveLatestContextWindowSnapshot(visibleTurnItems),
    [visibleTurnItems],
  );
  const activeWorkStartedAt = deriveActiveWorkStartedAt(
    thread?.latestRun ?? null,
    thread?.runtime ?? null,
    sendingStartedAt,
  );
  const isWorking = running || sending || isConnecting;
  const hasOlderTurns = threadHistory.hasMoreHistory;
  const loadingOlder = threadHistory.loading;
  const routeThreadKey = scopedThreadKey(target);
  const threadStateError = Option.getOrNull(threadState.error);
  const visibleError = error ?? thread?.runtime?.lastError ?? null;
  const environmentUnavailable =
    environment && !connected
      ? { label: environment.label, connection: environment.connection }
      : null;
  const lockedProvider = thread?.runtime ? (selectedProviderStatus?.driver ?? null) : null;

  useEffect(() => {
    if (!composerOverlayElement) return;
    const measure = () => setComposerOverlayHeight(composerOverlayElement.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(composerOverlayElement);
    return () => observer.disconnect();
  }, [composerOverlayElement]);

  const pageScrollControllerRef = useRef<ReturnType<typeof createPageScrollController> | null>(
    null,
  );
  useEffect(() => {
    const controller = createPageScrollController({
      getContainer: () => legendListRef.current?.getScrollableNode() ?? null,
      getScrollPaddingBottomPx: () => composerOverlayHeight,
      onScrollStart: (key) => {
        if (key === "PageUp") setTimelineLiveFollowEnabled(false);
      },
    });
    pageScrollControllerRef.current = controller;
    return () => {
      controller.dispose();
      if (pageScrollControllerRef.current === controller) pageScrollControllerRef.current = null;
    };
  }, [composerOverlayHeight]);
  const handlePageScrollKeyDown = useCallback((key: PageScrollKey) => {
    pageScrollControllerRef.current?.handleKeyDown(key);
  }, []);
  const handlePageScrollKeyUp = useCallback((key: string) => {
    pageScrollControllerRef.current?.handleKeyUp(key);
  }, []);
  const handlePageScrollRelease = useCallback(() => {
    pageScrollControllerRef.current?.releaseActiveKey();
  }, []);

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
    // Wait for the citation update to reach the editor before placing the caret.
    const frame = window.requestAnimationFrame(() => composerRef.current?.focusAtEnd());
    return () => window.cancelAnimationFrame(frame);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Each selection request must refocus the same target thread.
  }, [focusRequestId, thread?.id]);

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
        hasStartedSession: thread.runtime !== null,
        currentModelSelection: thread.modelSelection,
        currentProviderInstanceId: thread.runtime?.providerInstanceId,
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
        hasStartedSession: thread.runtime !== null,
        currentModelSelection: thread.modelSelection,
        currentProviderInstanceId: thread.runtime?.providerInstanceId,
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
      buildCompactChatInterruptCommand({ target, session: thread.runtime }),
    );
    const failure = commandFailureMessage(result, "Failed to interrupt the current turn.");
    if (failure) setError(failure);
  }, [connected, interruptTurn, running, target, thread]);

  const handleApproval = useCallback(
    async (requestId: RuntimeRequestId, decision: ProviderApprovalDecision) => {
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
    async (requestId: RuntimeRequestId, answers: Record<string, unknown>) => {
      const request = pendingUserInputs.find((request) => request.requestId === requestId);
      if (!connected || !request || userInputInFlight.current.has(requestId)) return;
      const attachmentsByQuestionId: Record<string, UserInputAttachments[string]> = {};
      for (const question of request.questions) {
        const draftId = questionAttachmentDraftId(
          target.environmentId,
          target.threadId,
          requestId,
          question.id,
        );
        if ((useQuestionAttachmentPreparation.getState().counts[draftId] ?? 0) > 0) return;
        const draft = useComposerDraftStore.getState().getComposerDraft(draftId);
        const attachments = draft ? [...draft.images, ...draft.files] : [];
        if (attachments.length === 0) continue;
        const uploaded = getUploadedAttachments({
          environmentId: target.environmentId,
          images: attachments,
        });
        if (!supportsQuestionAttachments || !uploaded) {
          setError("Wait for attachments to finish uploading, or remove failed uploads.");
          return;
        }
        attachmentsByQuestionId[question.id] = uploaded as UserInputAttachments[string];
      }
      userInputInFlight.current.add(requestId);
      setRespondingRequestIds((current) => [...new Set([...current, requestId])]);
      setError(null);
      try {
        const result = await respondToUserInput(
          buildCompactChatUserInputCommand({ target, requestId, answers, attachmentsByQuestionId }),
        );
        const failure = commandFailureMessage(result, "Failed to submit answers.");
        if (failure) setError(failure);
        return result;
      } finally {
        userInputInFlight.current.delete(requestId);
        setRespondingRequestIds((current) => current.filter((id) => id !== requestId));
      }
    },
    [connected, pendingUserInputs, respondToUserInput, supportsQuestionAttachments, target],
  );

  const handleDismissUserInput = useCallback(
    async (requestId: RuntimeRequestId) => {
      if (!connected || userInputInFlight.current.has(requestId)) return;
      userInputInFlight.current.add(requestId);
      setRespondingRequestIds((current) => [...new Set([...current, requestId])]);
      try {
        const result = await dismissUserInput({
          environmentId: target.environmentId,
          input: { threadId: target.threadId, requestId },
        });
        const failure = commandFailureMessage(result, "Failed to dismiss the question.");
        if (failure) setError(failure);
        return result;
      } finally {
        userInputInFlight.current.delete(requestId);
        setRespondingRequestIds((current) => current.filter((id) => id !== requestId));
      }
    },
    [connected, dismissUserInput, target],
  );

  const advancePendingUserInput = useCallback(() => {
    if (!activePendingUserInput || !activePendingProgress?.canAdvance) return;
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
    if (!thread || !connected || sendInFlightRef.current) return;
    if (activePendingProgress) {
      advancePendingUserInput();
      return;
    }
    if (running) return;
    const sendContext = composerRef.current?.getSendContext();
    if (!sendContext?.providerAvailable) return;
    const terminalContexts = filterTerminalContextsWithText(sendContext.terminalContexts);
    const prompt = sendContext.terminalContexts
      .filter((context) => !terminalContexts.includes(context))
      .reduce(
        (text, context) =>
          removeInlineContextReference(text, terminalContextReference(context).contextId).prompt,
        sendContext.prompt,
      )
      .trim();
    const composerAttachments = [...sendContext.images, ...sendContext.files];
    if (prompt.length === 0 && composerAttachments.length === 0) return;

    const outgoingText = formatOutgoingPrompt({
      provider: sendContext.selectedProvider,
      model: sendContext.selectedModel,
      models: sendContext.selectedProviderModels,
      effort: sendContext.selectedPromptEffort,
      text: prompt || "Describe the attached file.",
    });
    if (!composerRef.current?.validateProviderInput(outgoingText)) return;

    sendInFlightRef.current = true;
    if (supportsAttachmentUploads && composerAttachments.length > 0) {
      for (const image of composerAttachments) {
        startAttachmentUpload({ environmentId: target.environmentId, image, draftTarget: target });
      }
      await awaitAttachmentUploads(composerAttachments.map((image) => image.id));
      if (
        getUploadedAttachments({
          environmentId: target.environmentId,
          images: composerAttachments,
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
      const attachments: Array<UploadChatAttachment | ChatAttachment> = supportsAttachmentUploads
        ? (getUploadedAttachments({
            environmentId: target.environmentId,
            images: composerAttachments,
          }) ?? [])
        : await Promise.all(
            sendContext.images.map(async (image) => ({
              type: "image" as const,
              id: image.id,
              ...(image.source ? { source: image.source } : {}),
              name: image.name,
              mimeType: image.mimeType,
              sizeBytes: image.sizeBytes,
              dataUrl: await readFileAsDataUrl(image.file),
            })),
          );
      if (!supportsAttachmentUploads && sendContext.files.length > 0) {
        throw new Error("This server cannot upload file attachments.");
      }
      const context = buildMessageContext({
        terminalContexts,
        reviewComments: sendContext.reviewComments,
        threadContexts: sendContext.threadContexts,
        previewAnnotations: sendContext.previewAnnotations,
        attachments: composerAttachments.map((attachment, index) => ({
          attachment,
          attachmentId:
            (attachments[index] && "id" in attachments[index]
              ? attachments[index].id
              : undefined) ?? attachment.id,
        })),
      });
      const supportsInlineMessageContext =
        appAtomRegistry.get(environmentServerConfigsAtom).get(target.environmentId)?.environment
          .capabilities.inlineMessageContext === true;
      const text =
        context && !supportsInlineMessageContext
          ? serializeLegacyContextMessage({ text: outgoingText, records: context.records })
          : outgoingText;
      if (!composerRef.current?.validateProviderInput(text)) return;
      const result = await startTurn(
        buildCompactChatStartTurnCommand({
          owner,
          target,
          thread,
          text,
          ...(supportsInlineMessageContext && context ? { context } : {}),
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
          releaseDraftAttachments(composerAttachments);
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
    <div
      data-compact-chat-surface
      className="relative flex min-h-0 flex-1 flex-col bg-background"
      onKeyDown={(event) => {
        if (event.defaultPrevented || isCommandPaletteOpen() || !running || !connected) return;
        const command = resolveShortcutCommand(event.nativeEvent, keybindings, {
          context: {
            terminalFocus: false,
            terminalOpen: false,
            previewFocus: false,
            previewOpen: false,
            modelPickerOpen: composerRef.current?.isModelPickerOpen() ?? false,
            rightPanelOpen: true,
          },
        });
        if (command !== "thread.stop") return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) void handleInterrupt();
      }}
    >
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
          activeTurnInProgress={running}
          providerStatuses={providerStatuses}
          runs={threadProjection?.runs ?? []}
          onAnchorSizeChanged={() => {}}
          onOpenThread={(threadId) => {
            void navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(scopeThreadRef(target.environmentId, threadId)),
            });
          }}
          onForkFromRun={async (input) => {
            const targetThreadId = newThreadId();
            const outcome = await forkFromRun({
              environmentId: target.environmentId,
              input: { ...input, targetThreadId, title: `${thread.title} fork` },
            });
            if (outcome._tag === "Failure") {
              const failure = commandFailureMessage(outcome, "Could not fork this response.");
              if (failure) setError(failure);
              return;
            }
            const forkRef = scopeThreadRef(target.environmentId, targetThreadId);
            if (!(await waitForThreadShell(forkRef))) {
              setError(
                "The fork was created, but its thread has not reached this client. Reconnect and open it from the sidebar.",
              );
              return;
            }
            await navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(forkRef),
            });
          }}
          onRollbackCheckpoint={(input) =>
            void revertCheckpoint({
              environmentId: target.environmentId,
              input: { ...input, threadId: target.threadId },
            })
          }
          activeTurnStartedAt={activeWorkStartedAt}
          listRef={legendListRef}
          timelineEntries={timelineEntries}
          latestRun={thread.latestRun}
          runningRunId={thread.runtime?.status === "running" ? thread.runtime.activeRunId : null}
          routeThreadKey={routeThreadKey}
          onOpenTurnDiff={() => {}}
          turnDiffSummaries={[]}
          supportsConversationRollback={false}
          onRevertToTurnCount={() => {}}
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
          onContentOverflowChange={setTimelineOverflows}
          onManualNavigation={() => setTimelineLiveFollowEnabled(false)}
          topFadeEnabled={false}
          loadEarlier={
            hasOlderTurns
              ? {
                  loading: loadingOlder,
                  onLoadEarlier: () =>
                    loadEarlierHistory({
                      environmentId: target.environmentId,
                      input: { threadId: target.threadId },
                    }),
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
              className="pointer-events-auto"
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
            <ComposerSurface.Shell>
              <ComposerSurface.Host>
                <ChatComposer
                  composerRef={composerRef}
                  promptHistoryMessages={timelineEntries.flatMap((entry) =>
                    entry.kind === "message" ? [entry.message] : [],
                  )}
                  timelineOverflows={timelineOverflows}
                  composerDraftTarget={target}
                  environmentId={target.environmentId}
                  attachmentUploadsCapabilityKnown={attachmentUploadsCapabilityKnown}
                  supportsAttachmentUploads={supportsAttachmentUploads}
                  supportsQuestionAttachments={supportsQuestionAttachments}
                  maxFileAttachmentBytes={maxFileAttachmentBytes}
                  routeKind="server"
                  routeThreadRef={target}
                  draftId={null}
                  activeThreadId={thread.id}
                  activeThreadEnvironmentId={thread.environmentId}
                  activeThread={thread}
                  activeThreadShell={threadShell}
                  isServerThread
                  isLocalDraftThread={false}
                  forceExpandedOnMobile={false}
                  projectSelectionRequired={false}
                  phase={phase}
                  isConnecting={isConnecting}
                  isSendBusy={sending}
                  canInterrupt={running}
                  canResume={false}
                  onResume={() => {}}
                  editingQueuedAttachments={null}
                  onRemoveEditingQueuedAttachment={() => {}}
                  sendDisabledReason={
                    running
                      ? "Wait for this side-chat turn to finish before sending another message."
                      : null
                  }
                  isPreparingWorktree={false}
                  bannerItems={[]}
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
                  threadSyncPhase={null}
                  runtimeMode={runtimeMode}
                  interactionMode={interactionMode}
                  lockedProvider={lockedProvider}
                  providerStatuses={providerStatuses as ServerProvider[]}
                  providerCatalogKnown={environment.serverConfig !== null}
                  activeProjectDefaultModelSelection={projectSettings.defaultModelSelection}
                  activeThreadModelSelection={thread.modelSelection}
                  activeContextWindow={activeContextWindow}
                  compactThreadUnavailable
                  compactDisabled
                  compactDisabledReason="Compacting is not available from a side chat."
                  resolvedTheme={resolvedTheme}
                  settings={settings}
                  keybindings={keybindings}
                  terminalOpen={false}
                  gitCwd={thread.worktreePath ?? project?.workspaceRoot ?? null}
                  multipleModelSelections={null}
                  supportsMultipleModels={false}
                  onMultipleModelSelectionsChange={() => {}}
                  pullRequestProjectId={supportsPullRequests ? thread.projectId : null}
                  pullRequestRepository={
                    supportsPullRequests ? (project?.repositoryIdentity?.displayName ?? null) : null
                  }
                  onCompactContext={() => {}}
                  onDismissActivePendingUserInput={handleDismissUserInput}
                  restingControlsHost={null}
                  restingControlsHaveLeadingContext={false}
                  onRestingControlsVisibilityChange={() => {}}
                  getTimelineScrollableNode={() =>
                    legendListRef.current?.getScrollableNode() ?? null
                  }
                  isTimelineAtLogicalEnd={() => timelineLiveFollowEnabled}
                  onComposerOverlayHeightChange={() => {}}
                  onRestingChange={() => {}}
                  promptRef={promptRef}
                  composerImagesRef={composerImagesRef}
                  composerFilesRef={composerFilesRef}
                  composerTerminalContextsRef={composerTerminalContextsRef}
                  onPageScrollKeyDown={handlePageScrollKeyDown}
                  onPageScrollKeyUp={handlePageScrollKeyUp}
                  onPageScrollRelease={handlePageScrollRelease}
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
                  onOpenProviderSetup={() => {}}
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
                  onFileOpen={(attachment) => {
                    useRightPanelStore.getState().openAttachment(owner, attachment);
                  }}
                />
              </ComposerSurface.Host>
            </ComposerSurface.Shell>
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
