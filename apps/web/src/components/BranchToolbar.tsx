import { ThreadWorkspaceMenu } from "./ThreadWorkspaceMenu";
import { SoftPill } from "./ui/soft-pill";
import { useWorktreeDisplay } from "../hooks/useWorktreeDisplay";
import { ComposerContextLabel } from "./ComposerContextLabel";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { readLocalApi } from "../localApi";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { FolderGit2Icon, FolderGitIcon, FolderIcon, ScaleIcon } from "lucide-react";
import {
  type Ref,
  type MouseEvent as ReactMouseEvent,
  memo,
  useImperativeHandle,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { namedWorktreeKey, useNamedWorktreeStore } from "../namedWorktreeStore";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";
import { useProject, useQuietThreadShell, useThreadShellsForProjectRefs } from "../state/entities";
import {
  type EnvMode,
  type EnvironmentOption,
  resolveContextStripLabelsCompact,
  resolveCurrentWorkspaceLabel,
  resolveEnvModeLabel,
  resolvePreviousWorktreeSeed,
  resolveLockedWorkspaceLabel,
  type PreviousWorktreeSeed,
  shouldShowEnvironmentIndicator,
} from "./BranchToolbar.logic";
import {
  BranchToolbarBranchSelector,
  type BranchToolbarBranchSelectorHandle,
} from "./BranchToolbarBranchSelector";
import { BranchToolbarEnvironmentSelector } from "./BranchToolbarEnvironmentSelector";
import { WorkspaceMenu, type WorkspaceMenuProps } from "./WorkspaceMenu";
import { MenuGroup, MenuGroupLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator } from "./ui/menu";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "./chat/threadDetailsPanelStyles";
import { Separator } from "./ui/separator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { ComposerSurface } from "./chat/ComposerSurface";
import { measureRestingComposerControls } from "./chat/restingComposerControlsMeasurement";
import { resolveRestingComposerControlsNaturalWidth } from "./composerFooterLayout";
import { cn } from "~/lib/utils";
import { observeResize } from "~/lib/observeResize";

export interface BranchToolbarHandle {
  openBranchPicker: () => void;
  usePreviousWorktree: () => void;
}

interface BranchToolbarProps {
  layout?: "composer" | "panel";
  panelSection?: "all" | "workspace" | "branch";
  forceNewWorktree?: boolean;
  ref?: Ref<BranchToolbarHandle>;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  showGitControls: boolean;
  draftId?: DraftId;
  onEnvModeChange: (mode: EnvMode) => void;
  envMode: EnvMode;
  activeThreadBranchOverride?: string | null;
  onActiveThreadBranchOverrideChange?: (branch: string | null) => void;
  startFromOrigin: boolean;
  onStartFromOriginChange: (startFromOrigin: boolean) => void;
  autoEnvironmentLabel?: string | undefined;
  onAutoEnvironment?: (() => void) | undefined;
  envLocked: boolean;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
  availableEnvironments?: readonly EnvironmentOption[];
  onEnvironmentChange?: (environmentId: EnvironmentId) => void;
  composerControlsHostRef?: (element: HTMLDivElement | null) => void;
  contextStripVisible?: boolean;
}
/** Offers the existing checkout path through the native or web context menu. */
function showWorkspaceContextMenu(event: ReactMouseEvent, workspacePath: string) {
  const api = readLocalApi();
  if (!api) return;
  event.preventDefault();
  event.stopPropagation();
  void api.contextMenu
    .show([{ id: "copy-path", label: "Copy full path", icon: "copy" }], {
      x: event.clientX,
      y: event.clientY,
    })
    .then((action) => {
      if (action !== "copy-path") return;
      void writeTextToClipboard(workspacePath, "workspace path").then(
        (didCopy) => {
          if (didCopy) {
            toastManager.add({ type: "success", title: "Path copied", description: workspacePath });
          }
        },
        (error: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to copy path",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        },
      );
    });
}

interface RunContextSelectorProps {
  displayMode?: "toolbar" | "panel";
  workspaceRoot?: string;
  forceNewWorktree: boolean;
  autoEnvironmentLabel?: string | undefined;
  onAutoEnvironment?: (() => void) | undefined;
  envLocked: boolean;
  envModeLocked: boolean;
  environmentId: EnvironmentId;
  availableEnvironments: readonly EnvironmentOption[] | undefined;
  showEnvironmentPicker: boolean;
  showEnvironmentIndicator: boolean;
  onEnvironmentChange: ((environmentId: EnvironmentId) => void) | undefined;
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  onEnvModeChange: (mode: EnvMode) => void;
  workspaceProps: WorkspaceMenuProps;
}

const RunContextSelector = memo(function RunContextSelector({
  displayMode = "toolbar",
  workspaceRoot,
  forceNewWorktree,
  autoEnvironmentLabel,
  onAutoEnvironment,
  envLocked,
  envModeLocked,
  environmentId,
  availableEnvironments,
  showEnvironmentPicker,
  showEnvironmentIndicator,
  onEnvironmentChange,
  effectiveEnvMode,
  activeWorktreePath,
  workspaceProps,
}: RunContextSelectorProps) {
  const activeEnvironment =
    availableEnvironments?.find((env) => env.environmentId === environmentId) ?? null;
  const WorkspaceIcon = activeWorktreePath
    ? FolderGitIcon
    : effectiveEnvMode === "worktree"
      ? FolderGit2Icon
      : FolderIcon;
  const workspaceLabel = forceNewWorktree
    ? resolveEnvModeLabel("worktree")
    : envModeLocked
      ? resolveLockedWorkspaceLabel(activeWorktreePath, effectiveEnvMode)
      : effectiveEnvMode === "worktree" && !activeWorktreePath
        ? (workspaceProps.namedWorktreeSelection?.name ?? resolveEnvModeLabel("worktree"))
        : resolveCurrentWorkspaceLabel(activeWorktreePath);
  const isPanel = displayMode === "panel";
  const workspacePath =
    forceNewWorktree || (effectiveEnvMode === "worktree" && !activeWorktreePath)
      ? null
      : (activeWorktreePath ?? workspaceRoot);
  const workspaceColor = activeWorktreePath
    ? workspaceProps.activeWorktreeColor
    : workspaceProps.namedWorktreeSelection?.color;
  const workspaceIcon = (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
        {!isPanel && workspaceColor && effectiveEnvMode === "worktree" && !forceNewWorktree ? (
          <span
            aria-hidden
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: workspaceColor }}
          />
        ) : (
          <WorkspaceIcon
            className={
              isPanel
                ? THREAD_DETAILS_PANEL_ICON_CLASS
                : cn("size-3 shrink-0", showEnvironmentIndicator && "mx-0!")
            }
          />
        )}
      </TooltipTrigger>
      <TooltipPopup>
        {isPanel
          ? forceNewWorktree
            ? "Each model starts in its own worktree."
            : (workspacePath ?? workspaceLabel)
          : workspaceLabel}
      </TooltipPopup>
    </Tooltip>
  );
  const icon = showEnvironmentIndicator ? (
    // Button's base styles apply `-mx-0.5` to descendant SVGs, which eats 4px
    // out of whatever gap we set. mx-0! cancels that so gap-0.5 reads as 2px.
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
          {autoEnvironmentLabel ? (
            <ScaleIcon
              className={isPanel ? THREAD_DETAILS_PANEL_ICON_CLASS : "size-3 shrink-0 mx-0!"}
              aria-hidden="true"
            />
          ) : (
            <EnvironmentMachineIcon
              kind={activeEnvironment?.machine ?? "server"}
              className={isPanel ? THREAD_DETAILS_PANEL_ICON_CLASS : "size-3 shrink-0 mx-0!"}
            />
          )}
        </TooltipTrigger>
        <TooltipPopup>{autoEnvironmentLabel ?? activeEnvironment?.label ?? "Run on"}</TooltipPopup>
      </Tooltip>
      {workspaceIcon}
    </span>
  ) : (
    workspaceIcon
  );
  const triggerContent = (
    <>
      {icon}
      <ComposerContextLabel displayMode={displayMode}>
        {autoEnvironmentLabel ??
          (showEnvironmentIndicator ? (activeEnvironment?.label ?? "Run on") : workspaceLabel)}
      </ComposerContextLabel>
    </>
  );
  return (
    <WorkspaceMenu
      {...workspaceProps}
      displayMode={displayMode}
      canChooseEnvironment={showEnvironmentPicker && !envLocked}
      onContextMenu={
        isPanel && workspacePath
          ? (event) => showWorkspaceContextMenu(event, workspacePath)
          : undefined
      }
      trigger={triggerContent}
      environmentItems={
        <>
          {showEnvironmentPicker && availableEnvironments && onEnvironmentChange ? (
            <>
              <MenuGroup>
                <MenuGroupLabel>Run on</MenuGroupLabel>
                <MenuRadioGroup
                  value={autoEnvironmentLabel ? "auto" : environmentId}
                  onValueChange={(value) =>
                    value === "auto"
                      ? onAutoEnvironment?.()
                      : onEnvironmentChange(value as EnvironmentId)
                  }
                >
                  {onAutoEnvironment && (
                    <MenuRadioItem
                      value="auto"
                      disabled={envLocked}
                      closeOnClick
                      onClick={() => {
                        if (autoEnvironmentLabel) onAutoEnvironment?.();
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <ScaleIcon className="size-3" aria-hidden="true" />
                        <span className="min-w-0 truncate">
                          {autoEnvironmentLabel ?? "Auto balance"}
                        </span>
                      </span>
                    </MenuRadioItem>
                  )}
                  {availableEnvironments.map((env) => (
                    <MenuRadioItem
                      key={env.environmentId}
                      disabled={envLocked}
                      closeOnClick
                      value={env.environmentId}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <EnvironmentMachineIcon kind={env.machine} className="size-3" />
                        <span className="min-w-0 truncate">{env.label}</span>
                      </span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuGroup>
              <MenuSeparator />
            </>
          ) : null}
        </>
      }
    />
  );
});

const COMPOSER_CONTEXT_MOTION_DURATION_MS = 180;
const COMPOSER_CONTEXT_MOTION_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
const COMPOSER_CONTEXT_LABEL_SELECTOR = "[data-composer-label]";

/**
 * Reading one element's scrollWidth drops the tail when the label is hidden or
 * squeezed, and the strip then flips between labels and icons on every measure.
 */
function labelTextWidth(label: HTMLElement, range: Range): number {
  const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
  let width = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    range.selectNodeContents(node);
    width += range.getBoundingClientRect().width;
  }
  const motion = label.querySelector<HTMLElement>("[data-composer-label-motion]");
  const maxWidth = motion ? Number.parseFloat(getComputedStyle(motion).maxWidth) : Number.NaN;
  return Number.isFinite(maxWidth) ? Math.min(width, maxWidth) : width;
}

function useLabelsOverflow(element: HTMLDivElement | null): boolean {
  const [overflows, setOverflows] = useState(false);
  const pendingLabelRectsRef = useRef<Map<HTMLElement, DOMRect> | null>(null);
  const labelAnimationsRef = useRef(new Map<HTMLElement, Animation>());
  const measure = useEffectEvent(() => {
    const current = element;
    const compact = overflows;
    if (!current) return;
    const available = current.clientWidth;
    if (available === 0) return;
    const contentWidth = (parent: Element): number => {
      const gap = Number.parseFloat(getComputedStyle(parent).columnGap) || 0;
      let width = 0;
      let counted = 0;
      for (const child of parent.children) {
        if (!(child instanceof HTMLElement)) continue;
        if (child.offsetWidth === 0) continue;
        const style = getComputedStyle(child);
        const position = style.position;
        if (position === "absolute" || position === "fixed") continue;
        width +=
          child.offsetWidth +
          (Number.parseFloat(style.marginInlineStart) || 0) +
          (Number.parseFloat(style.marginInlineEnd) || 0);
        counted += 1;
      }
      return width + gap * Math.max(0, counted - 1);
    };
    const stripGap = Number.parseFloat(getComputedStyle(current).columnGap) || 0;
    let needed = 0;
    let groups = 0;
    for (const child of current.children) {
      if (!(child instanceof HTMLElement)) continue;
      // Reserve the natural width of the controls inside it, blocks in overflow
      // included, so Git labels compact before squeezing out the model picker.
      // Reserving only the visible controls would let the labels expand into
      // room the composer just freed, shrink the host, and hide the controls
      // again.
      const hostedControls = child.matches('[data-chat-resting-composer-controls-host="true"]')
        ? child.querySelector<HTMLElement>('[data-chat-composer-resting-controls="true"]')
        : null;
      const hostedMeasurement = hostedControls
        ? measureRestingComposerControls(hostedControls)
        : null;
      const width = hostedMeasurement
        ? resolveRestingComposerControlsNaturalWidth(hostedMeasurement)
        : contentWidth(hostedControls ?? child);
      if (width <= 1) continue;
      groups += 1;
      needed += width;
    }
    needed += stripGap * Math.max(0, groups - 1);
    const range = document.createRange();
    for (const label of current.querySelectorAll<HTMLElement>("[data-composer-label]")) {
      needed += Math.max(0, labelTextWidth(label, range) - label.getBoundingClientRect().width);
    }
    const nextOverflows = resolveContextStripLabelsCompact({
      compact,
      neededWidth: needed,
      availableWidth: available,
    });
    if (nextOverflows !== compact) {
      pendingLabelRectsRef.current = new Map(
        Array.from(current.querySelectorAll<HTMLElement>(COMPOSER_CONTEXT_LABEL_SELECTOR)).map(
          (label) => [label, label.getBoundingClientRect()],
        ),
      );
    }
    setOverflows(nextOverflows);
  });

  useLayoutEffect(() => {
    const previousRects = pendingLabelRectsRef.current;
    if (!previousRects) return;
    pendingLabelRectsRef.current = null;

    for (const animation of labelAnimationsRef.current.values()) {
      animation.cancel();
    }
    labelAnimationsRef.current.clear();

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    for (const [label, previousRect] of previousRects) {
      if (!label.isConnected) continue;
      const nextWidth = label.getBoundingClientRect().width;
      if (Math.abs(previousRect.width - nextWidth) < 0.5) continue;

      const animation = label.animate(
        [
          { width: `${previousRect.width}px`, maxWidth: `${previousRect.width}px` },
          { width: `${nextWidth}px`, maxWidth: `${nextWidth}px` },
        ],
        {
          duration: COMPOSER_CONTEXT_MOTION_DURATION_MS,
          easing: COMPOSER_CONTEXT_MOTION_EASING,
          fill: "backwards",
        },
      );
      labelAnimationsRef.current.set(label, animation);
      animation.addEventListener(
        "finish",
        () => {
          if (labelAnimationsRef.current.get(label) === animation) {
            labelAnimationsRef.current.delete(label);
          }
        },
        { once: true },
      );
    }
  });

  useEffect(
    () => () => {
      for (const animation of labelAnimationsRef.current.values()) {
        animation.cancel();
      }
    },
    [],
  );

  useLayoutEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- The label mode comes from measuring the committed DOM, which render cannot read.
    measure();
  });

  useEffect(() => {
    if (!element) return;
    const stopObserving = observeResize(element, measure);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      stopObserving();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [element]);

  return overflows;
}

export const BranchToolbar = memo(function BranchToolbar({
  layout = "composer",
  panelSection = "all",
  forceNewWorktree = false,
  ref,
  environmentId,
  threadId,
  showGitControls,
  draftId,
  onEnvModeChange,
  envMode,
  activeThreadBranchOverride,
  onActiveThreadBranchOverrideChange,
  startFromOrigin,
  onStartFromOriginChange,
  autoEnvironmentLabel,
  onAutoEnvironment,
  envLocked,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
  availableEnvironments,
  onEnvironmentChange,
  composerControlsHostRef,
  contextStripVisible = true,
}: BranchToolbarProps) {
  const branchSelectorRef = useRef<BranchToolbarBranchSelectorHandle>(null);
  const threadRef = scopeThreadRef(environmentId, threadId);
  const draftThread = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : store.getDraftThreadByRef(threadRef),
  );
  const serverThread = useQuietThreadShell(threadRef);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const activeProjectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const activeProject = useProject(activeProjectRef);
  const hasActiveThread = serverThread !== null || draftThread !== null;
  const activeWorktreePath = forceNewWorktree
    ? null
    : ((serverThread ?? draftThread)?.worktreePath ?? null);
  const namedWorktreeSelection = useNamedWorktreeStore((state) =>
    activeProjectRef
      ? (state.selections[namedWorktreeKey(activeProjectRef, threadId)] ?? null)
      : null,
  );
  const worktreeDisplay = useWorktreeDisplay(
    activeProjectRef,
    activeWorktreePath,
    activeProject?.workspaceRoot,
  );
  useEffect(() => {
    if (activeProjectRef && activeWorktreePath && namedWorktreeSelection) {
      useNamedWorktreeStore
        .getState()
        .record(activeProjectRef, [{ id: threadId, worktreePath: activeWorktreePath }]);
    }
  }, [activeProjectRef, activeWorktreePath, namedWorktreeSelection, threadId]);
  const effectiveEnvMode = forceNewWorktree ? "worktree" : envMode;
  const isLocalCheckout =
    !activeWorktreePath &&
    !forceNewWorktree &&
    (serverThread !== null || effectiveEnvMode === "local");
  const envModeLocked = envLocked || (serverThread !== null && activeWorktreePath !== null);
  /** Points an unsent draft at a selected existing checkout. */
  const onUseWorktree = (seed: PreviousWorktreeSeed) => {
    if (!activeProjectRef || !draftThread || serverThread || envModeLocked || forceNewWorktree)
      return;
    const worktreePath =
      seed.worktreePath === activeProject?.workspaceRoot ? null : seed.worktreePath;
    useNamedWorktreeStore.getState().select(activeProjectRef, threadId, null);
    setDraftThreadContext(draftId ?? threadRef, {
      branch: seed.branch,
      worktreePath,
      envMode: worktreePath ? "worktree" : "local",
      projectRef: activeProjectRef,
    });
  };
  // "Previous worktree" hops a draft into the most recently active worktree
  // of this project — the "keep going where I just was" follow-up flow. Only
  // drafts can hop; started server threads have their workspace pinned.
  const canUsePreviousWorktree =
    draftThread !== null && serverThread === null && !envModeLocked && !forceNewWorktree;
  const projectRefsForWorktreeLookup =
    canUsePreviousWorktree && activeProjectRef ? [activeProjectRef] : [];
  const projectThreads = useThreadShellsForProjectRefs(projectRefsForWorktreeLookup);
  const previousWorktreeSeed = canUsePreviousWorktree
    ? resolvePreviousWorktreeSeed({
        threads: projectThreads,
        currentWorktreePath: activeWorktreePath,
      })
    : null;
  /** Reuses the latest worktree through the same draft update as the workspace menu. */
  const onUsePreviousWorktree = () => {
    if (previousWorktreeSeed) onUseWorktree(previousWorktreeSeed);
  };

  useImperativeHandle(
    ref,
    () => ({
      openBranchPicker: () => branchSelectorRef.current?.open(),
      usePreviousWorktree: () => {
        if (!showGitControls || !canUsePreviousWorktree || !previousWorktreeSeed) return;
        onUsePreviousWorktree();
        onComposerFocusRequest?.();
      },
    }),
    [
      canUsePreviousWorktree,
      onComposerFocusRequest,
      onUsePreviousWorktree,
      previousWorktreeSeed,
      showGitControls,
    ],
  );

  const hasMultipleEnvironments = (availableEnvironments?.length ?? 0) > 1;
  const showEnvironmentPicker = hasMultipleEnvironments && onEnvironmentChange !== undefined;
  const activeEnvironmentOption =
    availableEnvironments?.find((env) => env.environmentId === environmentId) ?? null;
  // Started threads get no handler but still show which machine they run on,
  // matching the strip visibility ChatView computes from the same inputs.
  const showEnvironmentIndicator = shouldShowEnvironmentIndicator({
    activeEnvironment: activeEnvironmentOption,
    canPickEnvironment: hasMultipleEnvironments,
  });
  const [stripElement, setStripElement] = useState<HTMLDivElement | null>(null);
  const labelsOverflow = useLabelsOverflow(stripElement);
  if (!hasActiveThread || !activeProject || !activeProjectRef) return null;
  const activeWorktreeColor = worktreeDisplay?.color ?? null;
  const workspaceProps: WorkspaceMenuProps = {
    environmentId,
    projectRef: activeProjectRef,
    projectCwd: activeProject.workspaceRoot,
    activeWorktreePath,
    activeBranch: serverThread?.branch ?? draftThread?.branch ?? null,
    envLocked: envModeLocked || forceNewWorktree,
    forceNewWorktree,
    canUseWorktree: draftThread !== null && serverThread === null && !envModeLocked,
    effectiveEnvMode,
    onEnvModeChange,
    namedWorktreeSelection,
    activeWorktreeColor,
    onNewWorktreeSelect: (selection) => {
      useNamedWorktreeStore.getState().select(activeProjectRef, threadId, selection);
      onEnvModeChange("worktree");
    },
    onUseWorktree,
  };
  if (layout === "panel") {
    return (
      <div className="flex w-full flex-col" data-thread-panel-run-context>
        {panelSection !== "branch" ? (
          <RunContextSelector
            displayMode="panel"
            workspaceRoot={activeProject.workspaceRoot}
            forceNewWorktree={forceNewWorktree}
            autoEnvironmentLabel={autoEnvironmentLabel}
            onAutoEnvironment={onAutoEnvironment}
            envLocked={envLocked}
            envModeLocked={envModeLocked}
            environmentId={environmentId}
            availableEnvironments={availableEnvironments}
            showEnvironmentPicker={showEnvironmentPicker}
            showEnvironmentIndicator={activeEnvironmentOption !== null}
            onEnvironmentChange={onEnvironmentChange}
            effectiveEnvMode={effectiveEnvMode}
            activeWorktreePath={activeWorktreePath}
            onEnvModeChange={onEnvModeChange}
            workspaceProps={workspaceProps}
          />
        ) : null}
        {panelSection !== "workspace" ? (
          <>
            {showGitControls ? (
              <BranchToolbarBranchSelector
                displayMode="panel"
                className="w-full"
                environmentId={environmentId}
                threadId={threadId}
                {...(draftId ? { draftId } : {})}
                envLocked={envLocked}
                effectiveEnvModeOverride={effectiveEnvMode}
                {...(activeThreadBranchOverride !== undefined
                  ? { activeThreadBranchOverride }
                  : {})}
                {...(onActiveThreadBranchOverrideChange
                  ? { onActiveThreadBranchOverrideChange }
                  : {})}
                startFromOrigin={startFromOrigin}
                onStartFromOriginChange={onStartFromOriginChange}
                {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
                {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
              />
            ) : null}
            {worktreeDisplay || isLocalCheckout ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <div
                      className="w-full"
                      aria-label={isLocalCheckout ? "Local checkout" : "Worktree"}
                    />
                  }
                >
                  <ThreadWorkspaceMenu
                    threadRef={threadRef}
                    {...(draftId ? { draftId } : {})}
                    displayMode="panel"
                    ariaLabel="Edit workspace"
                    trigger={
                      <>
                        {isLocalCheckout ? (
                          <FolderIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} />
                        ) : (
                          <FolderGitIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} />
                        )}
                        <span className="min-w-0 flex-1 text-left">
                          {worktreeDisplay ? (
                            <SoftPill color={worktreeDisplay.color}>
                              {worktreeDisplay.name}
                            </SoftPill>
                          ) : (
                            "Local checkout"
                          )}
                        </span>
                      </>
                    }
                  />
                </TooltipTrigger>
                <TooltipPopup>{activeWorktreePath ?? activeProject.workspaceRoot}</TooltipPopup>
              </Tooltip>
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  return (
    <ComposerSurface.ContextStrip
      ref={setStripElement}
      data-compact={labelsOverflow ? "" : undefined}
      className={cn(
        "gap-1 text-xs font-normal text-muted-foreground/70",
        // A non-Git strip with no visible composer controls should occupy no
        // space, but its host must retain a prospective width so controls can
        // become visible again when the chat view grows.
        !contextStripVisible && "pointer-events-none invisible absolute inset-x-0 top-full",
      )}
    >
      {showGitControls ? (
        <div className="contents @3xl/composer-surface:hidden">
          <RunContextSelector
            forceNewWorktree={forceNewWorktree}
            autoEnvironmentLabel={autoEnvironmentLabel}
            onAutoEnvironment={onAutoEnvironment}
            envLocked={envLocked}
            envModeLocked={envModeLocked}
            environmentId={environmentId}
            availableEnvironments={availableEnvironments}
            showEnvironmentPicker={showEnvironmentPicker}
            showEnvironmentIndicator={showEnvironmentIndicator}
            onEnvironmentChange={onEnvironmentChange}
            effectiveEnvMode={effectiveEnvMode}
            activeWorktreePath={activeWorktreePath}
            onEnvModeChange={onEnvModeChange}
            workspaceProps={workspaceProps}
          />
        </div>
      ) : null}
      {showGitControls || showEnvironmentIndicator ? (
        <div
          className={cn(
            "min-h-7 min-w-10 items-center gap-1 sm:min-h-6",
            showGitControls ? "hidden @3xl/composer-surface:flex" : "flex",
            composerControlsHostRef ? "shrink" : "flex-1",
          )}
        >
          {showEnvironmentIndicator && availableEnvironments && (
            <>
              <BranchToolbarEnvironmentSelector
                autoEnvironmentLabel={autoEnvironmentLabel}
                onAutoEnvironment={onAutoEnvironment}
                envLocked={envLocked}
                environmentId={environmentId}
                availableEnvironments={availableEnvironments}
                {...(showEnvironmentPicker ? { onEnvironmentChange } : {})}
              />
              {showGitControls ? (
                <Separator
                  orientation="vertical"
                  className="mx-0.5 h-3.5!"
                  data-composer-context-control
                />
              ) : null}
            </>
          )}
          {showGitControls ? <WorkspaceMenu {...workspaceProps} /> : null}
        </div>
      ) : null}

      {composerControlsHostRef ? (
        <div
          ref={composerControlsHostRef}
          data-composer-context-control
          data-chat-resting-composer-controls-host="true"
          className="flex min-w-0 flex-1 items-center justify-start overflow-x-clip overflow-y-visible"
        />
      ) : null}

      {showGitControls ? (
        <BranchToolbarBranchSelector
          forceNewWorktree={forceNewWorktree}
          ref={branchSelectorRef}
          className="min-w-0 flex-initial justify-end @3xl/composer-surface:ml-auto"
          environmentId={environmentId}
          threadId={threadId}
          {...(draftId ? { draftId } : {})}
          envLocked={envLocked}
          effectiveEnvModeOverride={effectiveEnvMode}
          {...(activeThreadBranchOverride !== undefined ? { activeThreadBranchOverride } : {})}
          {...(onActiveThreadBranchOverrideChange ? { onActiveThreadBranchOverrideChange } : {})}
          startFromOrigin={startFromOrigin}
          onStartFromOriginChange={onStartFromOriginChange}
          {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
          {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
        />
      ) : null}
    </ComposerSurface.ContextStrip>
  );
});
