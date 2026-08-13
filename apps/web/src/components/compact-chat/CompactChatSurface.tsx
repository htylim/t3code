import { scopeProjectRef } from "@t3tools/client-runtime/environment";
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
  ProviderApprovalDecision,
  ScopedThreadRef,
  UserInputQuestion,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import {
  CircleAlertIcon,
  MessageSquareIcon,
  SendIcon,
  SquareIcon,
  WifiOffIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type SyntheticEvent,
} from "react";

import { useAssetUrls } from "~/assets/assetUrls";
import {
  clampCollapsedComposerCursor,
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  replaceTextRange,
  type ComposerTrigger,
} from "~/composer-logic";
import { useComposerDraftStore, useComposerThreadDraft } from "~/composerDraftStore";
import { useTheme } from "~/hooks/useTheme";
import { useComposerPathSearch } from "~/lib/composerPathSearchState";
import {
  buildPendingUserInputAnswers,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "~/pendingUserInput";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  deriveTimelineEntries,
  deriveTurnPlans,
  deriveWorkLogEntries,
} from "~/session-logic";
import { useEnvironment } from "~/state/environments";
import { readProject, readThreadShells, useProject, useThread } from "~/state/entities";
import { threadEnvironment, useEnvironmentThread } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import type { ChatMessage } from "~/types";
import { cn, newMessageId } from "~/lib/utils";
import { basenameOfPath } from "~/pierre-icons";
import { formatProviderSkillDisplayName } from "~/providerSkillPresentation";
import { searchProviderSkills } from "~/providerSkillSearch";
import { buildThreadReferenceItems } from "~/threadReference";
import ChatMarkdown from "~/components/ChatMarkdown";
import {
  type ComposerPromptEditorHandle,
  ComposerPromptEditor,
} from "~/components/ComposerPromptEditor";
import {
  type ComposerCommandItem,
  ComposerCommandMenu,
} from "~/components/chat/ComposerCommandMenu";
import { ComposerPendingApprovalActions } from "~/components/chat/ComposerPendingApprovalActions";
import { ComposerPendingApprovalPanel } from "~/components/chat/ComposerPendingApprovalPanel";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

import {
  buildCompactChatApprovalCommand,
  buildCompactChatInterruptCommand,
  buildCompactChatStartTurnCommand,
  buildCompactChatUserInputCommand,
  compactChatComposerItemReplacement,
  compactChatCanSend,
} from "./CompactChatSurface.logic";

interface CompactChatSurfaceProps {
  target: ScopedThreadRef;
}

const COMPACT_TIMELINE_INTERACTIVE_SELECTOR =
  "a, button, input, select, textarea, [role='button'], [role='link']";

function blockCompactTimelineInteraction(event: SyntheticEvent<HTMLElement>): void {
  const target = event.target;
  if (!(target instanceof Element) || !target.closest(COMPACT_TIMELINE_INTERACTIVE_SELECTOR)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}

function blockCompactTimelineKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key === "Enter" || event.key === " ") {
    blockCompactTimelineInteraction(event);
  }
}

function commandFailureMessage(
  result: AtomCommandResult<unknown, unknown>,
  fallback: string,
): string | null {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : fallback;
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

function CompactUserInput(props: {
  requestId: ApprovalRequestId;
  questions: ReadonlyArray<UserInputQuestion>;
  pendingCount: number;
  responding: boolean;
  onSubmit: (requestId: ApprovalRequestId, answers: Record<string, unknown>) => Promise<unknown>;
}) {
  const [drafts, setDrafts] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const answers = useMemo(
    () => buildPendingUserInputAnswers(props.questions, drafts),
    [drafts, props.questions],
  );

  return (
    <div className="border-t border-border/70 bg-muted/15 p-3">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[11px] font-semibold tracking-widest uppercase">Input needed</span>
        {props.pendingCount > 1 ? (
          <span className="text-xs text-muted-foreground">1/{props.pendingCount}</span>
        ) : null}
      </div>
      <div className="max-h-72 space-y-4 overflow-y-auto pr-1">
        {props.questions.map((question) => {
          const draft = drafts[question.id];
          const selected = draft?.selectedOptionLabels ?? [];
          return (
            <fieldset key={question.id} disabled={props.responding} className="space-y-2">
              <legend className="text-sm font-medium">{question.question}</legend>
              <div className="space-y-1.5">
                {question.options.map((option) => {
                  const active = selected.includes(option.label) && !draft?.customAnswer?.trim();
                  return (
                    <button
                      key={option.label}
                      type="button"
                      aria-pressed={active}
                      className={cn(
                        "flex w-full cursor-pointer flex-col rounded-md border px-2.5 py-2 text-left",
                        active
                          ? "border-primary/40 bg-primary/8"
                          : "border-border/70 hover:bg-accent/50",
                      )}
                      onClick={() =>
                        setDrafts((current) => ({
                          ...current,
                          [question.id]: togglePendingUserInputOptionSelection(
                            question,
                            current[question.id],
                            option.label,
                          ),
                        }))
                      }
                    >
                      <span className="text-xs font-medium">{option.label}</span>
                      {option.description !== option.label ? (
                        <span className="mt-0.5 text-[11px] text-muted-foreground">
                          {option.description}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <Input
                value={draft?.customAnswer ?? ""}
                placeholder="Other answer"
                aria-label={`${question.header} custom answer`}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [question.id]: setPendingUserInputCustomAnswer(
                      current[question.id],
                      event.target.value,
                    ),
                  }))
                }
              />
            </fieldset>
          );
        })}
      </div>
      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          disabled={answers === null || props.responding}
          onClick={() => {
            if (answers) void props.onSubmit(props.requestId, answers);
          }}
        >
          {props.responding ? "Sending…" : "Submit answers"}
        </Button>
      </div>
    </div>
  );
}

export function CompactChatSurface({ target }: CompactChatSurfaceProps) {
  const { resolvedTheme } = useTheme();
  const environment = useEnvironment(target.environmentId);
  const threadState = useEnvironmentThread(target.environmentId, target.threadId);
  const thread = useThread(target);
  const project = useProject(
    thread ? scopeProjectRef(thread.environmentId, thread.projectId) : null,
  );
  const draft = useComposerThreadDraft(target);
  const setPrompt = useComposerDraftStore((state) => state.setPrompt);
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const respondToApproval = useAtomCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const respondToUserInput = useAtomCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const [sending, setSending] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [respondingRequestIds, setRespondingRequestIds] = useState<ApprovalRequestId[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [composerCursor, setComposerCursor] = useState(() =>
    collapseExpandedComposerCursor(draft.prompt, draft.prompt.length),
  );
  const [composerTrigger, setComposerTrigger] = useState<ComposerTrigger | null>(() =>
    detectComposerTrigger(draft.prompt, draft.prompt.length),
  );
  const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followLiveRef = useRef(true);
  const composerEditorRef = useRef<ComposerPromptEditorHandle>(null);
  const composerSelectLockRef = useRef(false);

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
  const activeApproval = pendingApprovals[0] ?? null;
  const activeUserInput = pendingUserInputs[0] ?? null;
  const connected = environment?.connection.phase === "connected";
  const selectedProviderStatus =
    thread === null
      ? undefined
      : environment?.serverConfig?.providers.find(
          (provider) =>
            provider.instanceId ===
            (thread.session?.providerInstanceId ?? thread.modelSelection.instanceId),
        );
  const providerAvailable =
    selectedProviderStatus?.enabled === true &&
    selectedProviderStatus.availability !== "unavailable";
  const running = thread?.session?.status === "running" || thread?.session?.status === "starting";
  const hasPendingRequest = activeApproval !== null || activeUserInput !== null;
  const canSend = compactChatCanSend({
    connected,
    providerAvailable,
    threadAvailable: thread !== null && threadState.status !== "deleted",
    session: thread?.session ?? null,
    hasPendingRequest,
    sending,
  });
  const threadStateError = Option.getOrNull(threadState.error);
  const hasOlderTurns = threadHasOlderTurns(threadState);
  const loadingOlder = threadState.page._tag === "Some" && threadState.page.value.loadingOlder;
  const composerCwd = thread?.worktreePath ?? project?.workspaceRoot ?? null;
  const pathTriggerQuery = composerTrigger?.kind === "path" ? composerTrigger.query : "";
  const workspaceEntries = useComposerPathSearch({
    environmentId: target.environmentId,
    cwd: composerTrigger?.kind === "path" ? composerCwd : null,
    query: composerTrigger?.kind === "path" ? pathTriggerQuery : null,
  });
  const threadReferenceItems = useMemo(() => {
    if (composerTrigger?.kind !== "thread") return [];
    const threads = readThreadShells().filter(
      (candidate) => candidate.environmentId === target.environmentId,
    );
    const projects = [
      ...new Map(
        threads.flatMap((candidate) => {
          const candidateProject = readProject({
            environmentId: target.environmentId,
            projectId: candidate.projectId,
          });
          return candidateProject ? [[candidateProject.id, candidateProject] as const] : [];
        }),
      ).values(),
    ];
    return buildThreadReferenceItems({
      environmentId: target.environmentId,
      currentThreadId: target.threadId,
      query: composerTrigger.query,
      threads,
      projects,
    });
  }, [composerTrigger, target.environmentId, target.threadId]);
  const composerMenuItems = useMemo<ComposerCommandItem[]>(() => {
    if (composerTrigger?.kind === "thread") {
      return threadReferenceItems.map((item) => ({
        ...item,
        id: `thread:${item.threadRef.environmentId}:${item.threadRef.threadId}`,
        type: "thread" as const,
      }));
    }
    if (composerTrigger?.kind === "path") {
      return workspaceEntries.entries.map((entry) => ({
        id: `path:${entry.kind}:${entry.path}`,
        type: "path" as const,
        path: entry.path,
        pathKind: entry.kind,
        label: basenameOfPath(entry.path),
        description: entry.path.slice(0, Math.max(0, entry.path.lastIndexOf("/"))),
      }));
    }
    if (composerTrigger?.kind === "skill" && selectedProviderStatus) {
      return searchProviderSkills(selectedProviderStatus.skills ?? [], composerTrigger.query).map(
        (skill) => ({
          id: `skill:${selectedProviderStatus.driver}:${skill.name}`,
          type: "skill" as const,
          provider: selectedProviderStatus.driver,
          skill,
          label: formatProviderSkillDisplayName(skill),
          description:
            skill.shortDescription ??
            skill.description ??
            (skill.scope ? `${skill.scope} skill` : "Run provider skill"),
        }),
      );
    }
    return [];
  }, [composerTrigger, selectedProviderStatus, threadReferenceItems, workspaceEntries.entries]);
  const activeComposerMenuItem =
    composerMenuItems.find((item) => item.id === composerHighlightedItemId) ??
    composerMenuItems[0] ??
    null;
  const composerMenuEmptyState =
    composerTrigger?.kind === "skill"
      ? "No skills found."
      : composerTrigger?.kind === "thread"
        ? "No matching threads."
        : "No matching files or folders.";
  const isComposerMenuLoading =
    composerTrigger?.kind === "path" && pathTriggerQuery.length > 0 && workspaceEntries.isPending;

  useEffect(() => {
    setComposerCursor((current) => clampCollapsedComposerCursor(draft.prompt, current));
  }, [draft.prompt]);

  useEffect(() => {
    const nextCursor = collapseExpandedComposerCursor(draft.prompt, draft.prompt.length);
    setComposerCursor(nextCursor);
    setComposerTrigger(detectComposerTrigger(draft.prompt, draft.prompt.length));
    setComposerHighlightedItemId(null);
  }, [target.environmentId, target.threadId]);

  useEffect(() => {
    if (!followLiveRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [timelineEntries]);

  const handleSend = useCallback(async () => {
    const text = draft.prompt.trim();
    if (!thread || !text || !canSend) return;
    setSending(true);
    setError(null);
    const result = await startTurn(
      buildCompactChatStartTurnCommand({
        target,
        thread,
        text,
        messageId: newMessageId(),
        createdAt: new Date().toISOString(),
      }),
    );
    const failure = commandFailureMessage(result, "Failed to send message.");
    if (failure) setError(failure);
    if (result._tag === "Success") {
      setPrompt(target, "");
      setComposerCursor(0);
      setComposerTrigger(null);
      setComposerHighlightedItemId(null);
      followLiveRef.current = true;
    }
    setSending(false);
  }, [canSend, draft.prompt, setPrompt, startTurn, target, thread]);

  const handleComposerChange = useCallback(
    (
      nextPrompt: string,
      nextCursor: number,
      expandedCursor: number,
      cursorAdjacentToMention: boolean,
    ) => {
      setPrompt(target, nextPrompt);
      setComposerCursor(nextCursor);
      setComposerTrigger(
        cursorAdjacentToMention ? null : detectComposerTrigger(nextPrompt, expandedCursor),
      );
      setComposerHighlightedItemId(null);
    },
    [setPrompt, target],
  );

  const handleComposerItemSelect = useCallback(
    (item: ComposerCommandItem) => {
      if (composerSelectLockRef.current) return;
      const snapshot = composerEditorRef.current?.readSnapshot();
      if (!snapshot) return;
      const trigger = detectComposerTrigger(snapshot.value, snapshot.expandedCursor);
      if (!trigger) return;
      if (
        (item.type === "path" && trigger.kind !== "path") ||
        (item.type === "thread" && trigger.kind !== "thread") ||
        (item.type === "skill" && trigger.kind !== "skill")
      ) {
        return;
      }
      const replacement = compactChatComposerItemReplacement(item);
      if (replacement === null) return;

      composerSelectLockRef.current = true;
      window.requestAnimationFrame(() => {
        composerSelectLockRef.current = false;
      });
      const rangeEnd =
        replacement.endsWith(" ") && snapshot.value[trigger.rangeEnd] === " "
          ? trigger.rangeEnd + 1
          : trigger.rangeEnd;
      const next = replaceTextRange(snapshot.value, trigger.rangeStart, rangeEnd, replacement);
      const nextCursor = collapseExpandedComposerCursor(next.text, next.cursor);
      const nextExpandedCursor = expandCollapsedComposerCursor(next.text, nextCursor);
      setPrompt(target, next.text);
      setComposerCursor(nextCursor);
      setComposerTrigger(detectComposerTrigger(next.text, nextExpandedCursor));
      setComposerHighlightedItemId(null);
      window.requestAnimationFrame(() => composerEditorRef.current?.focusAt(nextCursor));
    },
    [setPrompt, target],
  );

  const handleComposerCommandKey = useCallback(
    (key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab", event: KeyboardEvent) => {
      if (composerTrigger) {
        if ((key === "ArrowDown" || key === "ArrowUp") && composerMenuItems.length > 0) {
          const activeIndex = activeComposerMenuItem
            ? composerMenuItems.findIndex((item) => item.id === activeComposerMenuItem.id)
            : key === "ArrowDown"
              ? -1
              : 0;
          const offset = key === "ArrowDown" ? 1 : -1;
          const nextIndex =
            (activeIndex + offset + composerMenuItems.length) % composerMenuItems.length;
          setComposerHighlightedItemId(composerMenuItems[nextIndex]?.id ?? null);
          return true;
        }
        if ((key === "Enter" || key === "Tab") && activeComposerMenuItem) {
          handleComposerItemSelect(activeComposerMenuItem);
          return true;
        }
      }
      if (key === "Enter" && !event.shiftKey) {
        void handleSend();
        return true;
      }
      return false;
    },
    [
      activeComposerMenuItem,
      composerMenuItems,
      composerTrigger,
      handleComposerItemSelect,
      handleSend,
    ],
  );

  const handleInterrupt = useCallback(async () => {
    if (!thread || !connected || !running || interrupting) return;
    setInterrupting(true);
    setError(null);
    const result = await interruptTurn(
      buildCompactChatInterruptCommand({ target, session: thread.session }),
    );
    const failure = commandFailureMessage(result, "Failed to interrupt the current turn.");
    if (failure) setError(failure);
    setInterrupting(false);
  }, [connected, interruptTurn, interrupting, running, target, thread]);

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

  if (!environment) {
    return (
      <div data-compact-chat-surface className="flex min-h-0 flex-1 flex-col">
        <CompactState
          icon={WifiOffIcon}
          title="Environment unavailable"
          detail="This Chat surface is still bound to its original environment. Close it or reconnect that environment."
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
          detail="The target thread no longer exists. Closing this surface will not affect any other thread."
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
              ? "This Chat surface could not load its target thread."
              : "Loading the target thread and its conversation history.")
          }
        />
      </div>
    );
  }

  const statusLabel = activeApproval
    ? "Approval needed"
    : activeUserInput
      ? "Input needed"
      : running
        ? thread.session?.status === "starting"
          ? "Starting"
          : "Working"
        : !providerAvailable
          ? "Provider unavailable"
          : thread.session?.status === "error"
            ? "Failed"
            : "Ready";

  return (
    <div data-compact-chat-surface className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{thread.title}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {environment.label} · {statusLabel}
          </p>
        </div>
        {running ? (
          <Button
            size="sm"
            variant="outline"
            disabled={interrupting || !connected}
            onClick={handleInterrupt}
          >
            <SquareIcon className="size-3 fill-current" />
            {interrupting ? "Stopping…" : "Stop"}
          </Button>
        ) : null}
      </div>

      {!connected ? (
        <div className="flex items-center gap-2 border-b border-border/70 bg-warning/8 px-3 py-2 text-xs text-muted-foreground">
          <WifiOffIcon className="size-3.5 shrink-0" />
          {environment.connection.phase === "connecting"
            ? "Connecting to the target environment…"
            : environment.connection.phase === "reconnecting"
              ? "Reconnecting to the target environment…"
              : "Target environment disconnected. Cached messages remain visible."}
        </div>
      ) : null}

      {connected && !providerAvailable ? (
        <div className="flex items-center gap-2 border-b border-border/70 bg-warning/8 px-3 py-2 text-xs text-muted-foreground">
          <CircleAlertIcon className="size-3.5 shrink-0" />
          This thread's provider is unavailable. Open it in the main chat to change providers.
        </div>
      ) : null}

      {error || thread.session?.lastError ? (
        <div className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{error ?? thread.session?.lastError}</span>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
        onScroll={(event) => {
          const node = event.currentTarget;
          followLiveRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
      >
        {hasOlderTurns ? (
          <button
            type="button"
            disabled={loadingOlder}
            className="mb-3 w-full cursor-pointer py-1 text-xs text-muted-foreground hover:text-foreground disabled:cursor-default"
            onClick={() => requestOlderThreadTurns(target.environmentId, target.threadId)}
          >
            {loadingOlder ? "Loading earlier turns…" : "Load earlier turns"}
          </button>
        ) : null}
        {timelineEntries.length === 0 ? (
          <div className="flex min-h-32 items-center justify-center text-center text-xs text-muted-foreground">
            No messages yet.
          </div>
        ) : (
          <div
            className="space-y-3 [&_a]:cursor-text [&_button]:cursor-text"
            data-compact-chat-timeline
            onAuxClickCapture={blockCompactTimelineInteraction}
            onClickCapture={blockCompactTimelineInteraction}
            onContextMenuCapture={blockCompactTimelineInteraction}
            onKeyDownCapture={blockCompactTimelineKeyDown}
          >
            {timelineEntries.map((entry) => {
              if (entry.kind === "message") {
                const user = entry.message.role === "user";
                return (
                  <div
                    key={entry.id}
                    className={cn("flex", user ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "min-w-0 max-w-[92%] text-sm",
                        user
                          ? "rounded-2xl bg-message px-3 py-2.5 text-message-foreground"
                          : "w-full px-1 py-0.5",
                      )}
                    >
                      {entry.message.attachments && entry.message.attachments.length > 0 ? (
                        <div className="mb-2 grid grid-cols-2 gap-2">
                          {entry.message.attachments.map((attachment) =>
                            attachment.previewUrl ? (
                              <img
                                key={attachment.id}
                                src={attachment.previewUrl}
                                alt={attachment.name}
                                className="max-h-48 w-full rounded-md border border-border/70 object-cover"
                              />
                            ) : (
                              <div
                                key={attachment.id}
                                className="rounded-md border border-border/70 p-2 text-xs text-muted-foreground"
                              >
                                {attachment.name}
                              </div>
                            ),
                          )}
                        </div>
                      ) : null}
                      {user ? (
                        <p className="whitespace-pre-wrap break-words">{entry.message.text}</p>
                      ) : (
                        <ChatMarkdown
                          text={
                            entry.message.text ||
                            (entry.message.streaming ? "" : "(empty response)")
                          }
                          cwd={project?.workspaceRoot}
                          threadRef={target}
                          isStreaming={Boolean(entry.message.streaming)}
                        />
                      )}
                    </div>
                  </div>
                );
              }
              if (entry.kind === "proposed-plan") {
                return (
                  <div key={entry.id} className="rounded-lg border border-border/70 p-3">
                    <p className="mb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                      Plan
                    </p>
                    <ChatMarkdown
                      text={entry.proposedPlan.planMarkdown}
                      cwd={project?.workspaceRoot}
                      threadRef={target}
                    />
                  </div>
                );
              }
              if (entry.kind === "turn-plan") {
                return (
                  <div key={entry.id} className="rounded-lg border border-border/70 p-3">
                    <p className="mb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                      Progress
                    </p>
                    <div className="space-y-1.5">
                      {entry.turnPlan.plan.steps.map((step) => (
                        <div key={step.step} className="flex gap-2 text-xs">
                          <span className="w-3 shrink-0 text-center text-muted-foreground">
                            {step.status === "completed"
                              ? "✓"
                              : step.status === "inProgress"
                                ? "●"
                                : "○"}
                          </span>
                          <span>{step.step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }
              return (
                <div key={entry.id} className="rounded-md bg-muted/30 px-2.5 py-2 text-xs">
                  <p className="font-medium">{entry.entry.label}</p>
                  {entry.entry.detail ? (
                    <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
                      {entry.entry.detail}
                    </pre>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {activeApproval ? (
        <div className="border-t border-border/70 bg-muted/15">
          <ComposerPendingApprovalPanel
            approval={activeApproval}
            pendingCount={pendingApprovals.length}
          />
          <div className="flex flex-wrap justify-end gap-2 px-3 pb-3">
            <ComposerPendingApprovalActions
              requestId={activeApproval.requestId}
              isResponding={!connected || respondingRequestIds.includes(activeApproval.requestId)}
              onRespondToApproval={handleApproval}
            />
          </div>
        </div>
      ) : activeUserInput ? (
        <CompactUserInput
          key={activeUserInput.requestId}
          requestId={activeUserInput.requestId}
          questions={activeUserInput.questions}
          pendingCount={pendingUserInputs.length}
          responding={!connected || respondingRequestIds.includes(activeUserInput.requestId)}
          onSubmit={handleUserInput}
        />
      ) : (
        <div className="border-t border-border/70 p-3">
          <div className="relative rounded-md border border-input bg-transparent px-2.5 py-2 shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
            {composerTrigger ? (
              <div className="absolute inset-x-0 bottom-full z-50 mb-2">
                <ComposerCommandMenu
                  items={composerMenuItems}
                  resolvedTheme={resolvedTheme}
                  isLoading={isComposerMenuLoading}
                  triggerKind={composerTrigger.kind}
                  emptyStateText={composerMenuEmptyState}
                  activeItemId={activeComposerMenuItem?.id ?? null}
                  onHighlightedItemChange={setComposerHighlightedItemId}
                  onSelect={handleComposerItemSelect}
                />
              </div>
            ) : null}
            <ComposerPromptEditor
              editorRef={composerEditorRef}
              value={draft.prompt}
              cursor={composerCursor}
              terminalContexts={[]}
              skills={selectedProviderStatus?.skills ?? []}
              disabled={sending || running}
              placeholder={
                running
                  ? "Wait for the current turn to finish"
                  : "Message this thread, @tag files/folders, $use skills, or %reference threads"
              }
              className="min-h-12 max-h-36 text-sm"
              onRemoveTerminalContext={() => {}}
              onChange={handleComposerChange}
              onCommandKeyDown={handleComposerCommandKey}
              onPaste={() => {}}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              Enter to send · Shift+Enter for newline
            </p>
            <Button
              size="sm"
              disabled={!canSend || draft.prompt.trim().length === 0}
              onClick={() => void handleSend()}
            >
              <SendIcon className="size-3.5" />
              {sending ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
