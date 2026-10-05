import { threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { ChevronDownIcon, ChevronRightIcon, FolderIcon } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import type { SidebarDraftRowData } from "../../components/Sidebar";
import {
  resolveSidebarThreadAttention,
  resolveThreadLastVisitedAt,
} from "../../components/Sidebar.logic";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { InlineButton } from "../../components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { useUiStateStore } from "../../uiStateStore";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import type { ProjectCardState } from "./preferences";
import {
  compareProjectCards,
  projectCardProjectByPhysicalKey,
  projectCardThreadKey,
  projectCardVisibleThreads,
  PROJECT_CARD_PREVIEW_COUNT,
  type ProjectCardGroup,
} from "./projectCards.logic";

interface ProjectPreviewCardsProps {
  readonly cards: readonly ProjectCardGroup[];
  readonly projects: readonly SidebarProjectSnapshot[];
  readonly drafts: readonly SidebarDraftRowData[];
  readonly cardStates: Readonly<Record<string, ProjectCardState>>;
  readonly selectedThreadKey: string | null;
  readonly selectedDraftId: string | null;
  readonly revealedSelection: boolean;
  readonly now: string;
  readonly onCardStateChange: (projectKey: string, state: ProjectCardState) => void;
  readonly renderThreadRow: (thread: EnvironmentThreadShell) => ReactNode;
  readonly renderDraftRow: (draft: SidebarDraftRowData) => ReactNode;
}

interface ProjectCardWithDrafts extends ProjectCardGroup {
  readonly drafts: readonly SidebarDraftRowData[];
}

/** Add draft-only projects without including drafts in the three-thread preview limit. */
function cardsWithDrafts(
  cards: readonly ProjectCardGroup[],
  projects: readonly SidebarProjectSnapshot[],
  drafts: readonly SidebarDraftRowData[],
): ProjectCardWithDrafts[] {
  const projectsByPhysicalKey = projectCardProjectByPhysicalKey(projects);
  const cardsByProjectKey = new Map<string, ProjectCardWithDrafts>();
  for (const card of cards) cardsByProjectKey.set(card.projectKey, { ...card, drafts: [] });
  for (const draft of drafts) {
    const physicalProjectKey = `${draft.session.environmentId}:${draft.session.projectId}`;
    const project = projectsByPhysicalKey.get(physicalProjectKey) ?? null;
    const projectKey = project?.projectKey ?? physicalProjectKey;
    const existing = cardsByProjectKey.get(projectKey);
    if (existing !== undefined) {
      cardsByProjectKey.set(projectKey, { ...existing, drafts: [...existing.drafts, draft] });
    } else {
      cardsByProjectKey.set(projectKey, {
        projectKey,
        project,
        threads: [],
        drafts: [draft],
        timestampMs: Date.parse(draft.session.createdAt) || 0,
      });
    }
  }
  return [...cardsByProjectKey.values()].sort(compareProjectCards);
}

/** Aggregate existing row attention signals, including rows hidden by preview or collapse. */
function ProjectAttentionDot({ card, now }: { card: ProjectCardGroup; now: string }) {
  const needsAttention = useUiStateStore((store) =>
    card.threads.some((thread) => {
      const lastVisitedAt = resolveThreadLastVisitedAt(
        thread.lastVisitedAt,
        store.threadLastVisitedAtById[projectCardThreadKey(thread)],
      );
      const attention = resolveSidebarThreadAttention({
        thread,
        lastVisitedAt,
        wokeAt: threadWokeAt(thread, { now }),
      });
      return attention.isUnread || attention.isWoke;
    }),
  );
  if (!needsAttention) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label="New or unread activity"
            className="size-2 shrink-0 rounded-full bg-info"
          />
        }
      />
      <TooltipPopup>New or unread activity</TooltipPopup>
    </Tooltip>
  );
}

/** Render project containers inside the existing sidebar scroll area using shared rows. */
export function ProjectPreviewCards(props: ProjectPreviewCardsProps) {
  const cards = useMemo(
    () => cardsWithDrafts(props.cards, props.projects, props.drafts),
    [props.cards, props.drafts, props.projects],
  );
  return cards.map((card) => {
    const state = props.cardStates[card.projectKey] ?? "preview";
    const containsSelectedThread = card.threads.some(
      (thread) => projectCardThreadKey(thread) === props.selectedThreadKey,
    );
    const containsSelectedDraft = card.drafts.some(
      (draft) => draft.draftId === props.selectedDraftId,
    );
    const revealSelection =
      props.revealedSelection && (containsSelectedThread || containsSelectedDraft);
    const isOpen = state !== "collapsed" || revealSelection;
    const visibleThreads = projectCardVisibleThreads(
      card.threads,
      state,
      props.selectedThreadKey,
      revealSelection,
    );
    const projectName = card.project?.displayName ?? "Unknown project";
    return (
      <li
        key={card.projectKey}
        data-project-card={card.projectKey}
        className="my-1.5 list-none rounded-xl border border-sidebar-border/70 bg-sidebar-row-hover/20"
      >
        <button
          type="button"
          aria-label={`${isOpen ? "Collapse" : "Expand"} ${projectName}`}
          aria-expanded={isOpen}
          onClick={() => props.onCardStateChange(card.projectKey, isOpen ? "collapsed" : "preview")}
          className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left text-sidebar-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {card.project ? (
            <ProjectFavicon project={card.project} className="size-4 shrink-0" />
          ) : (
            <FolderIcon aria-hidden className="size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{projectName}</span>
          <span
            className="text-xs tabular-nums text-sidebar-muted-foreground"
            aria-label={`${card.threads.length} active threads`}
          >
            {card.threads.length}
          </span>
          <ProjectAttentionDot card={card} now={props.now} />
          {isOpen ? (
            <ChevronDownIcon
              aria-hidden
              className="size-3.5 shrink-0 text-sidebar-muted-foreground"
            />
          ) : (
            <ChevronRightIcon
              aria-hidden
              className="size-3.5 shrink-0 text-sidebar-muted-foreground"
            />
          )}
        </button>
        {isOpen ? (
          <ul role="presentation" className="px-1 pb-1">
            {card.drafts.map(props.renderDraftRow)}
            {card.drafts.length > 0 && visibleThreads.length > 0 ? (
              <li aria-hidden className="mx-2 my-1.5 h-px list-none bg-sidebar-border/60" />
            ) : null}
            {visibleThreads.map(props.renderThreadRow)}
            {card.threads.length > PROJECT_CARD_PREVIEW_COUNT ? (
              <li className="flex list-none px-2 py-2 text-xs">
                <InlineButton
                  onClick={() =>
                    props.onCardStateChange(
                      card.projectKey,
                      state === "expanded" ? "preview" : "expanded",
                    )
                  }
                >
                  {state === "expanded" ? "Show less" : `Show all ${card.threads.length}`}
                </InlineButton>
              </li>
            ) : null}
          </ul>
        ) : null}
      </li>
    );
  });
}
