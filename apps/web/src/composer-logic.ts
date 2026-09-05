import type { AssistantCitation } from "@t3tools/contracts";
import {
  serializeAssistantCitation,
  withAssistantCitationComment,
} from "@t3tools/shared/assistantCitations";
import {
  collectComposerPromptInlineTokens,
  splitPromptIntoComposerSegments,
  type ComposerPromptSegment,
} from "./composer-editor-mentions";
import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "./lib/terminalContext";
import {
  parseStandaloneComposerCommand,
  parseStandaloneComposerSlashCommand,
  type ComposerSlashCommand,
} from "@t3tools/shared/composerCommands";
export { parseStandaloneComposerSlashCommand };
export type { ComposerSlashCommand };
export type ComposerTriggerKind = "path" | "slash-command" | "skill" | "thread";
export type ComposerSubmissionIntent = "foreground" | "background";

export interface ComposerTrigger {
  kind: ComposerTriggerKind;
  query: string;
  rangeStart: number;
  rangeEnd: number;
  threadScope?: "project" | "environment";
}

export function formatAssistantCitationForComposer(citation: AssistantCitation, comment = "") {
  return `${serializeAssistantCitation(withAssistantCitationComment(citation, comment))} `;
}

export function composerSubmissionIntentForEnter(input: {
  isMobileViewport: boolean;
  shiftKey: boolean;
  modifierKey: boolean;
  isDraftThread: boolean;
}): ComposerSubmissionIntent | null {
  if (input.isMobileViewport || input.shiftKey) {
    return null;
  }
  return input.modifierKey && input.isDraftThread ? "background" : "foreground";
}

const isInlineTokenSegment = (segment: ComposerPromptSegment): boolean => segment.type !== "text";

function clampCursor(text: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return text.length;
  return Math.max(0, Math.min(text.length, Math.floor(cursor)));
}

function isWhitespace(char: string): boolean {
  return (
    char === " " ||
    char === "\n" ||
    char === "\t" ||
    char === "\r" ||
    char === INLINE_TERMINAL_CONTEXT_PLACEHOLDER
  );
}

function tokenStartForCursor(text: string, cursor: number): number {
  let index = cursor - 1;
  while (index >= 0 && !isWhitespace(text[index] ?? "")) {
    index -= 1;
  }
  return index + 1;
}

export function expandCollapsedComposerCursor(text: string, cursorInput: number): number {
  const collapsedCursor = clampCursor(text, cursorInput);
  const segments = splitPromptIntoComposerSegments(text);
  if (segments.length === 0) {
    return collapsedCursor;
  }

  let remaining = collapsedCursor;
  let expandedCursor = 0;

  for (const segment of segments) {
    if (segment.type === "mention" || segment.type === "citation" || segment.type === "thread") {
      const expandedLength = segment.source.length;
      if (remaining <= 1) {
        return expandedCursor + (remaining === 0 ? 0 : expandedLength);
      }
      remaining -= 1;
      expandedCursor += expandedLength;
      continue;
    }
    if (segment.type === "skill") {
      const expandedLength = segment.name.length + 1;
      if (remaining <= 1) {
        return expandedCursor + (remaining === 0 ? 0 : expandedLength);
      }
      remaining -= 1;
      expandedCursor += expandedLength;
      continue;
    }
    if (segment.type === "terminal-context") {
      if (remaining <= 1) {
        return expandedCursor + remaining;
      }
      remaining -= 1;
      expandedCursor += 1;
      continue;
    }

    const segmentLength = segment.text.length;
    if (remaining <= segmentLength) {
      return expandedCursor + remaining;
    }
    remaining -= segmentLength;
    expandedCursor += segmentLength;
  }

  return expandedCursor;
}

function collapsedSegmentLength(segment: ComposerPromptSegment): number {
  if (segment.type === "text") {
    return segment.text.length;
  }
  return 1;
}

function clampCollapsedComposerCursorForSegments(
  segments: ReadonlyArray<ComposerPromptSegment>,
  cursorInput: number,
): number {
  const collapsedLength = segments.reduce(
    (total, segment) => total + collapsedSegmentLength(segment),
    0,
  );
  if (!Number.isFinite(cursorInput)) {
    return collapsedLength;
  }
  return Math.max(0, Math.min(collapsedLength, Math.floor(cursorInput)));
}

export function clampCollapsedComposerCursor(text: string, cursorInput: number): number {
  return clampCollapsedComposerCursorForSegments(
    splitPromptIntoComposerSegments(text),
    cursorInput,
  );
}

export function collapseExpandedComposerCursor(text: string, cursorInput: number): number {
  const expandedCursor = clampCursor(text, cursorInput);
  const segments = splitPromptIntoComposerSegments(text);
  if (segments.length === 0) {
    return expandedCursor;
  }

  let remaining = expandedCursor;
  let collapsedCursor = 0;

  for (const segment of segments) {
    if (segment.type === "mention" || segment.type === "citation" || segment.type === "thread") {
      const expandedLength = segment.source.length;
      if (remaining === 0) {
        return collapsedCursor;
      }
      if (remaining <= expandedLength) {
        return collapsedCursor + 1;
      }
      remaining -= expandedLength;
      collapsedCursor += 1;
      continue;
    }
    if (segment.type === "skill") {
      const expandedLength = segment.name.length + 1;
      if (remaining === 0) {
        return collapsedCursor;
      }
      if (remaining <= expandedLength) {
        return collapsedCursor + 1;
      }
      remaining -= expandedLength;
      collapsedCursor += 1;
      continue;
    }
    if (segment.type === "terminal-context") {
      if (remaining <= 1) {
        return collapsedCursor + remaining;
      }
      remaining -= 1;
      collapsedCursor += 1;
      continue;
    }

    const segmentLength = segment.text.length;
    if (remaining <= segmentLength) {
      return collapsedCursor + remaining;
    }
    remaining -= segmentLength;
    collapsedCursor += segmentLength;
  }

  return collapsedCursor;
}

export function isCollapsedCursorAdjacentToInlineToken(
  text: string,
  cursorInput: number,
  direction: "left" | "right",
): boolean {
  const segments = splitPromptIntoComposerSegments(text);
  if (!segments.some(isInlineTokenSegment)) {
    return false;
  }

  const cursor = clampCollapsedComposerCursorForSegments(segments, cursorInput);
  let collapsedOffset = 0;

  for (const segment of segments) {
    if (isInlineTokenSegment(segment)) {
      if (direction === "left" && cursor === collapsedOffset + 1) {
        return true;
      }
      if (direction === "right" && cursor === collapsedOffset) {
        return true;
      }
    }
    collapsedOffset += collapsedSegmentLength(segment);
  }

  return false;
}

export function detectComposerTrigger(
  text: string,
  cursorInput: number,
  dismissedThreadStarts: readonly number[] = [],
): ComposerTrigger | null {
  const cursor = clampCursor(text, cursorInput);
  const lineStart = text.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const linePrefix = text.slice(lineStart, cursor);

  if (linePrefix.startsWith("/")) {
    const commandMatch = /^\/(\S*)$/.exec(linePrefix);
    if (commandMatch) {
      const commandQuery = commandMatch[1] ?? "";
      return {
        kind: "slash-command",
        query: commandQuery,
        rangeStart: lineStart,
        rangeEnd: cursor,
      };
    }
  }

  const tokenStart = tokenStartForCursor(text, cursor);
  const token = text.slice(tokenStart, cursor);
  if (token.startsWith("$")) {
    return {
      kind: "skill",
      query: token.slice(1),
      rangeStart: tokenStart,
      rangeEnd: cursor,
    };
  }
  if (token.startsWith("@")) {
    return {
      kind: "path",
      query: token.slice(1),
      rangeStart: tokenStart,
      rangeEnd: cursor,
    };
  }
  let rangeStart = cursor - 1;
  while (rangeStart >= 0) {
    if (text[rangeStart] === "%" && (rangeStart === 0 || isWhitespace(text[rangeStart - 1] ?? "")))
      break;
    rangeStart--;
  }
  if (rangeStart < 0 || dismissedThreadStarts.includes(rangeStart)) return null;
  const markerLength = text.slice(rangeStart, cursor).startsWith("%%") ? 2 : 1;
  if (text.slice(rangeStart, cursor).startsWith("%%%")) return null;
  // A selected inline token ends earlier queries; its label is never a trigger.
  for (const inlineToken of collectComposerPromptInlineTokens(text)) {
    if (inlineToken.start >= cursor) break;
    if (inlineToken.end > rangeStart) return null;
  }
  return {
    kind: "thread",
    threadScope: markerLength === 2 ? "environment" : "project",
    query: text.slice(rangeStart + markerLength, cursor),
    rangeStart,
    rangeEnd: cursor,
  };
}

/** Keeps escaped thread queries dismissed as text and the caret change. */
export function createComposerTriggerDetector() {
  let previousText = "";
  let dismissedThreadStarts: number[] = [];
  const detect = (text: string, cursor: number) => {
    if (dismissedThreadStarts.length > 0 && text !== previousText) {
      let start = 0;
      while (
        start < text.length &&
        start < previousText.length &&
        text[start] === previousText[start]
      )
        start++;
      let oldEnd = previousText.length;
      let newEnd = text.length;
      while (oldEnd > start && newEnd > start && previousText[oldEnd - 1] === text[newEnd - 1]) {
        oldEnd--;
        newEnd--;
      }
      // Move dismissed markers with an edit, dropping any markers it replaces.
      dismissedThreadStarts = dismissedThreadStarts.flatMap((position) =>
        position < start ? [position] : position >= oldEnd ? [position + newEnd - oldEnd] : [],
      );
    }
    previousText = text;
    return detectComposerTrigger(text, cursor, dismissedThreadStarts);
  };
  return {
    detect,
    dismiss(text: string, cursor: number) {
      const trigger = detect(text, cursor);
      if (trigger?.kind !== "thread") return false;
      dismissedThreadStarts.push(trigger.rangeStart);
      return true;
    },
    reset() {
      previousText = "";
      dismissedThreadStarts = [];
    },
  };
}

export function resolveComposerSubmissionAction(input: {
  readonly text: string;
  readonly attachmentCount: number;
  readonly contextCount: number;
  readonly planFollowUpAvailable?: boolean;
}): "fork" | "interaction-mode" | "plan-follow-up" | "message" {
  const command = parseStandaloneComposerCommand(input);
  if (command === "fork") return "fork";
  if (input.planFollowUpAvailable === true) return "plan-follow-up";
  return command === "plan" || command === "default" ? "interaction-mode" : "message";
}

export async function executeWebForkSubmission(input: {
  readonly fork: () => Promise<{ readonly ok: true } | { readonly ok: false; message: string }>;
  readonly clearCommand: () => void;
  readonly reportError: (message: string) => void;
}): Promise<boolean> {
  const result = await input.fork();
  if (!result.ok) {
    input.reportError(result.message);
    return false;
  }
  input.clearCommand();
  return true;
}

export function replaceTextRange(
  text: string,
  rangeStart: number,
  rangeEnd: number,
  replacement: string,
): { text: string; cursor: number } {
  const safeStart = Math.max(0, Math.min(text.length, rangeStart));
  const safeEnd = Math.max(safeStart, Math.min(text.length, rangeEnd));
  const nextText = `${text.slice(0, safeStart)}${replacement}${text.slice(safeEnd)}`;
  return { text: nextText, cursor: safeStart + replacement.length };
}
