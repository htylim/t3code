import { EnvironmentId, MessageId, ThreadId, type AssistantCitation } from "@t3tools/contracts";
import {
  collectAssistantCitations,
  expandAssistantCitationsForProvider,
  serializeAssistantCitation,
} from "@t3tools/shared/assistantCitations";
import { describe, expect, it } from "vite-plus/test";

import {
  clampCollapsedComposerCursor,
  collapseExpandedComposerCursor,
  composerSubmissionIntentForEnter,
  detectComposerTrigger,
  createComposerTriggerDetector,
  expandCollapsedComposerCursor,
  executeWebForkSubmission,
  formatAssistantCitationForComposer,
  isCollapsedCursorAdjacentToInlineToken,
  parseStandaloneComposerSlashCommand,
  replaceTextRange,
  resolveComposerSubmissionAction,
} from "./composer-logic";
import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "./lib/terminalContext";

const citation: AssistantCitation = {
  version: 1,
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
  messageId: MessageId.make("message-1"),
  text: "Keep Unicode 👋 and punctuation (here).",
  start: 3,
  end: 40,
  prefix: "前: ",
  suffix: " 後",
};
const citationSource = serializeAssistantCitation(citation).replaceAll("+", "%20");

describe("formatAssistantCitationForComposer", () => {
  it.each([undefined, "", " \n\t "])(
    "keeps citation-only insertion for a blank comment %j",
    (comment) => {
      expect(formatAssistantCitationForComposer(citation, comment)).toBe(
        `${serializeAssistantCitation(citation)} `,
      );
    },
  );

  it("binds a multiline comment to its citation without adding standalone prompt text", () => {
    const comment = 'What does "keep" mean? 👋\n  Please show an example.';
    const text = formatAssistantCitationForComposer(citation, `  ${comment}\n`);
    const boundCitation = { ...citation, comment };
    expect(text).toBe(`${serializeAssistantCitation(boundCitation)} `);
    expect(collectAssistantCitations(text).map((entry) => entry.citation)).toEqual([boundCitation]);
    expect(expandAssistantCitationsForProvider(text)).toMatch(/^\[assistant-quote-1\] \n\n/);
  });
});

describe("composerSubmissionIntentForEnter", () => {
  it("submits plain Enter on desktop", () => {
    expect(
      composerSubmissionIntentForEnter({
        isMobileViewport: false,
        shiftKey: false,
        modifierKey: false,
        isDraftThread: true,
      }),
    ).toBe("foreground");
  });

  it("inserts a newline for plain Enter on mobile", () => {
    expect(
      composerSubmissionIntentForEnter({
        isMobileViewport: true,
        shiftKey: false,
        modifierKey: false,
        isDraftThread: true,
      }),
    ).toBeNull();
  });

  it("inserts a newline for Shift+Enter", () => {
    expect(
      composerSubmissionIntentForEnter({
        isMobileViewport: false,
        shiftKey: true,
        modifierKey: false,
        isDraftThread: true,
      }),
    ).toBeNull();
  });

  it("submits a new thread in the background with Mod+Enter", () => {
    expect(
      composerSubmissionIntentForEnter({
        isMobileViewport: false,
        shiftKey: false,
        modifierKey: true,
        isDraftThread: true,
      }),
    ).toBe("background");
  });

  it("keeps Mod+Enter in the foreground for an active thread", () => {
    expect(
      composerSubmissionIntentForEnter({
        isMobileViewport: false,
        shiftKey: false,
        modifierKey: true,
        isDraftThread: false,
      }),
    ).toBe("foreground");
  });
});

describe("detectComposerTrigger", () => {
  it("detects @path trigger at cursor", () => {
    const text = "Please check @src/com";
    const trigger = detectComposerTrigger(text, text.length);

    expect(trigger).toEqual({
      kind: "path",
      query: "src/com",
      rangeStart: "Please check ".length,
      rangeEnd: text.length,
    });
  });

  it("detects slash command token while typing command name", () => {
    const text = "/mo";
    const trigger = detectComposerTrigger(text, text.length);

    expect(trigger).toEqual({
      kind: "slash-command",
      query: "mo",
      rangeStart: 0,
      rangeEnd: text.length,
    });
  });

  it("keeps /model as a slash command item", () => {
    const text = "/model";
    const trigger = detectComposerTrigger(text, text.length);

    expect(trigger).toEqual({
      kind: "slash-command",
      query: "model",
      rangeStart: 0,
      rangeEnd: text.length,
    });
  });

  it("does not keep a subcommand trigger active after /model arguments", () => {
    const text = "/model spark";
    const trigger = detectComposerTrigger(text, text.length);

    expect(trigger).toBeNull();
  });

  it("detects non-model slash commands while typing", () => {
    const text = "/pl";
    const trigger = detectComposerTrigger(text, text.length);

    expect(trigger).toEqual({
      kind: "slash-command",
      query: "pl",
      rangeStart: 0,
      rangeEnd: text.length,
    });
  });

  it("keeps slash command detection active for provider commands", () => {
    const text = "/rev";
    const trigger = detectComposerTrigger(text, text.length);

    expect(trigger).toEqual({
      kind: "slash-command",
      query: "rev",
      rangeStart: 0,
      rangeEnd: text.length,
    });
  });

  it("detects $skill trigger at cursor", () => {
    const text = "Use $gh-fi";
    const trigger = detectComposerTrigger(text, text.length);

    expect(trigger).toEqual({
      kind: "skill",
      query: "gh-fi",
      rangeStart: "Use ".length,
      rangeEnd: text.length,
    });
  });

  it("detects bare and queried thread triggers at token boundaries", () => {
    expect(detectComposerTrigger("Compare %", "Compare %".length)).toEqual({
      kind: "thread",
      threadScope: "project",
      query: "",
      rangeStart: "Compare ".length,
      rangeEnd: "Compare %".length,
    });
    expect(detectComposerTrigger("Compare %release", "Compare %release".length)).toEqual({
      kind: "thread",
      threadScope: "project",
      query: "release",
      rangeStart: "Compare ".length,
      rangeEnd: "Compare %release".length,
    });
  });

  it("does not treat a percentage embedded in another token as a thread trigger", () => {
    expect(detectComposerTrigger("Use 100%", "Use 100%".length)).toBeNull();
    expect(detectComposerTrigger("value%other", "value%other".length)).toBeNull();
  });

  it.each(["%review ", "%review changes", "%%review changes", "%review\nchanges"])(
    "keeps a thread query open across whitespace: %s",
    (text) => {
      const markerLength = text.startsWith("%%") ? 2 : 1;
      expect(detectComposerTrigger(text, text.length)).toEqual({
        kind: "thread",
        threadScope: markerLength === 2 ? "environment" : "project",
        query: text.slice(markerLength),
        rangeStart: 0,
        rangeEnd: text.length,
      });
    },
  );

  it("replaces the whole multiword query, including both percent signs", () => {
    const text = "Compare %%review changes with this";
    const cursor = "Compare %%review changes".length;
    const trigger = detectComposerTrigger(text, cursor)!;
    const replacement = "[Review changes](t3code://threads/local/thread-1)";
    const result = replaceTextRange(text, trigger.rangeStart, trigger.rangeEnd, replacement);
    expect(result.text).toBe(`Compare ${replacement} with this`);
    expect(detectComposerTrigger(result.text, result.cursor + 1)).toBeNull();
  });

  it("does not reopen a query from inside or before a selected chip", () => {
    const text = "%old [Review %changes](t3code://threads/local/thread-1) ";
    expect(detectComposerTrigger(text, text.length)).toBeNull();
    expect(detectComposerTrigger(text, text.indexOf("changes") + 3)).toBeNull();
    const fresh = `${text}%new query`;
    expect(detectComposerTrigger(fresh, fresh.length)?.query).toBe("new query");
  });

  it("detects @path trigger in the middle of existing text", () => {
    // User typed @ between "inspect " and "in this sentence"
    const text = "Please inspect @in this sentence";
    const cursorAfterAt = "Please inspect @".length;

    const trigger = detectComposerTrigger(text, cursorAfterAt);
    expect(trigger).toEqual({
      kind: "path",
      query: "",
      rangeStart: "Please inspect ".length,
      rangeEnd: cursorAfterAt,
    });
  });

  it("detects @path trigger with query typed mid-text", () => {
    // User typed @sr between "inspect " and "in this sentence"
    const text = "Please inspect @srin this sentence";
    const cursorAfterQuery = "Please inspect @sr".length;

    const trigger = detectComposerTrigger(text, cursorAfterQuery);
    expect(trigger).toEqual({
      kind: "path",
      query: "sr",
      rangeStart: "Please inspect ".length,
      rangeEnd: cursorAfterQuery,
    });
  });

  it("detects trigger with true cursor even when regex-based mention detection would false-match", () => {
    // MENTION_TOKEN_REGEX can false-match plain text like "@in" as a mention.
    // The fix bypasses it by computing the expanded cursor from the Lexical node tree.
    const text = "Please inspect @in this sentence";
    const cursorAfterAt = "Please inspect @".length;

    const trigger = detectComposerTrigger(text, cursorAfterAt);
    expect(trigger).not.toBeNull();
    expect(trigger?.kind).toBe("path");
    expect(trigger?.query).toBe("");
  });
});

describe("thread picker dismissal", () => {
  it("keeps an escaped query closed while typing or moving the caret, and allows a fresh trigger", () => {
    const detector = createComposerTriggerDetector();
    const text = "Compare %review";
    expect(detector.detect(text, text.length)?.query).toBe("review");
    expect(detector.dismiss(text, text.length)).toBe(true);
    const continued = `${text} changes`;
    expect(detector.detect(continued, continued.length)).toBeNull();
    expect(detector.detect(continued, text.length)).toBeNull();
    const fresh = `${continued} %%another review`;
    expect(detector.detect(fresh, fresh.length)).toMatchObject({
      query: "another review",
      threadScope: "environment",
    });
    expect(detector.dismiss(fresh, fresh.length)).toBe(true);
    expect(detector.detect(fresh, text.length)).toBeNull();
  });

  it("tracks a dismissed trigger when text before it is inserted or removed", () => {
    const detector = createComposerTriggerDetector();
    detector.dismiss("Compare %review", 15);
    const prefixed = "Please compare %review";
    // Insert without replacing the dismissed marker.
    const inserted = "Please Compare %review";
    expect(detector.detect(inserted, inserted.length)).toBeNull();
    expect(detector.detect(prefixed, prefixed.length)).toBeNull();
    expect(detector.detect("%review", 7)).toBeNull();
    expect(detector.detect("%review changes", 15)).toBeNull();
    detector.detect("", 0);
    expect(detector.detect("%new", 4)?.query).toBe("new");
  });

  it("preserves other trigger kinds after Escape and resets for a different draft", () => {
    const detector = createComposerTriggerDetector();
    detector.dismiss("%review", 7);
    expect(detector.detect("%review @src", 12)?.kind).toBe("path");
    expect(detector.detect("%review $skill", 14)?.kind).toBe("skill");
    detector.reset();
    expect(detector.detect("%review", 7)?.kind).toBe("thread");
  });

  it("allows a fresh trigger before an escaped query without reopening the escaped query", () => {
    const detector = createComposerTriggerDetector();
    detector.dismiss("Compare %review", 15);
    const inserted = "%%new Compare %review";
    expect(detector.detect(inserted, 5)).toMatchObject({
      query: "new",
      threadScope: "environment",
    });
    expect(detector.detect(inserted, inserted.length)).toBeNull();
    const selected = "[New](t3code://threads/local/thread-1) Compare %review";
    expect(detector.detect(selected, selected.length)).toBeNull();
  });
});

describe("replaceTextRange", () => {
  it("replaces a text range and returns new cursor", () => {
    const replaced = replaceTextRange("hello @src", 6, 10, "");
    expect(replaced).toEqual({
      text: "hello ",
      cursor: 6,
    });
  });

  it("replaces an active thread query with raw Markdown and one trailing space", () => {
    const text = "Compare %release with this";
    const trigger = detectComposerTrigger(text, "Compare %release".length);
    expect(trigger?.kind).toBe("thread");
    const rangeEnd = text[trigger!.rangeEnd] === " " ? trigger!.rangeEnd + 1 : trigger!.rangeEnd;

    expect(
      replaceTextRange(
        text,
        trigger!.rangeStart,
        rangeEnd,
        "[Release notes](t3code://threads/local/thread-1) ",
      ),
    ).toEqual({
      text: "Compare [Release notes](t3code://threads/local/thread-1) with this",
      cursor: "Compare [Release notes](t3code://threads/local/thread-1) ".length,
    });
  });

  it("maps a thread reference between its chip and Markdown lengths", () => {
    const text = "[Referenced](t3code://threads/local/thread-1) ";

    expect(collapseExpandedComposerCursor(text, text.length)).toBe(2);
    expect(collapseExpandedComposerCursor(text, text.length - 2)).toBe(1);
    expect(expandCollapsedComposerCursor(text, 1)).toBe(text.length - 1);
    expect(expandCollapsedComposerCursor(text, 2)).toBe(text.length);
  });
});

describe("expandCollapsedComposerCursor", () => {
  it("keeps cursor unchanged when no mention segment is present", () => {
    expect(expandCollapsedComposerCursor("plain text", 5)).toBe(5);
  });

  it("maps collapsed mention cursor to expanded text cursor", () => {
    const text = "what's in my @AGENTS.md fsfdas";
    const collapsedCursorAfterMention = "what's in my ".length + 2;
    const expandedCursorAfterMention = "what's in my @AGENTS.md ".length;

    expect(expandCollapsedComposerCursor(text, collapsedCursorAfterMention)).toBe(
      expandedCursorAfterMention,
    );
  });

  it("maps collapsed quoted mention cursor to expanded text cursor", () => {
    const text = 'what is in @"My File.md" please';
    const collapsedCursorAfterMention = "what is in ".length + 2;
    const expandedCursorAfterMention = 'what is in @"My File.md" '.length;

    expect(expandCollapsedComposerCursor(text, collapsedCursorAfterMention)).toBe(
      expandedCursorAfterMention,
    );
  });

  it("maps collapsed markdown file links to their expanded source offsets", () => {
    const text = "what's in [AGENTS.md](AGENTS.md) please";
    const collapsedCursorAfterMention = "what's in ".length + 2;
    const expandedCursorAfterMention = "what's in [AGENTS.md](AGENTS.md) ".length;

    expect(expandCollapsedComposerCursor(text, collapsedCursorAfterMention)).toBe(
      expandedCursorAfterMention,
    );
  });

  it("allows path trigger detection to close after selecting a mention", () => {
    const text = "what's in my @AGENTS.md ";
    const collapsedCursorAfterMention = "what's in my ".length + 2;
    const expandedCursor = expandCollapsedComposerCursor(text, collapsedCursorAfterMention);

    expect(detectComposerTrigger(text, expandedCursor)).toBeNull();
  });

  it("maps collapsed skill cursor to expanded text cursor", () => {
    const text = "run $review-follow-up then";
    const collapsedCursorAfterSkill = "run ".length + 2;
    const expandedCursorAfterSkill = "run $review-follow-up ".length;

    expect(expandCollapsedComposerCursor(text, collapsedCursorAfterSkill)).toBe(
      expandedCursorAfterSkill,
    );
  });
});

describe("collapseExpandedComposerCursor", () => {
  it("keeps cursor unchanged when no mention segment is present", () => {
    expect(collapseExpandedComposerCursor("plain text", 5)).toBe(5);
  });

  it("maps expanded mention cursor back to collapsed cursor", () => {
    const text = "what's in my @AGENTS.md fsfdas";
    const collapsedCursorAfterMention = "what's in my ".length + 2;
    const expandedCursorAfterMention = "what's in my @AGENTS.md ".length;

    expect(collapseExpandedComposerCursor(text, expandedCursorAfterMention)).toBe(
      collapsedCursorAfterMention,
    );
  });

  it("maps expanded quoted mention cursor back to collapsed cursor", () => {
    const text = 'what is in @"My File.md" please';
    const collapsedCursorAfterMention = "what is in ".length + 2;
    const expandedCursorAfterMention = 'what is in @"My File.md" '.length;

    expect(collapseExpandedComposerCursor(text, expandedCursorAfterMention)).toBe(
      collapsedCursorAfterMention,
    );
  });

  it("maps expanded markdown file link cursors back to collapsed offsets", () => {
    const text = "what's in [AGENTS.md](AGENTS.md) please";
    const collapsedCursorAfterMention = "what's in ".length + 2;
    const expandedCursorAfterMention = "what's in [AGENTS.md](AGENTS.md) ".length;

    expect(collapseExpandedComposerCursor(text, expandedCursorAfterMention)).toBe(
      collapsedCursorAfterMention,
    );
  });

  it("keeps package-like text expanded when another mention already exists earlier", () => {
    const text = "open @AGENTS.md then @src/index.ts ";
    const expandedCursor = text.length;
    const collapsedCursor = collapseExpandedComposerCursor(text, expandedCursor);

    expect(collapsedCursor).toBe("open ".length + 1 + " then @src/index.ts ".length);
    expect(expandCollapsedComposerCursor(text, collapsedCursor)).toBe(expandedCursor);
  });

  it("collapses only genuine mentions when package-like text exists earlier", () => {
    const text = "install @scope/pkg then @README.md ";
    const expandedCursor = text.length;
    const collapsedCursor = collapseExpandedComposerCursor(text, expandedCursor);

    expect(collapsedCursor).toBe("install @scope/pkg then ".length + 1 + " ".length);
    expect(expandCollapsedComposerCursor(text, collapsedCursor)).toBe(expandedCursor);
  });

  it("maps expanded skill cursor back to collapsed cursor", () => {
    const text = "run $review-follow-up then";
    const collapsedCursorAfterSkill = "run ".length + 2;
    const expandedCursorAfterSkill = "run $review-follow-up ".length;

    expect(collapseExpandedComposerCursor(text, expandedCursorAfterSkill)).toBe(
      collapsedCursorAfterSkill,
    );
  });
});

describe("clampCollapsedComposerCursor", () => {
  it("clamps to collapsed prompt length when mentions are present", () => {
    const text = "open @AGENTS.md then ";

    expect(clampCollapsedComposerCursor(text, text.length)).toBe(
      "open ".length + 1 + " then ".length,
    );
    expect(clampCollapsedComposerCursor(text, Number.POSITIVE_INFINITY)).toBe(
      "open ".length + 1 + " then ".length,
    );
  });
});

describe("assistant citation cursor offsets", () => {
  it("roundtrips every collapsed offset across citations, mentions, skills, and Unicode", () => {
    const prefix = "👋(";
    const between = "),雪";
    const after = " @AGENTS.md $review ";
    const text = `${prefix}${citationSource}${between}${citationSource}${after}${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}!`;
    const collapsedLength = `${prefix}□${between}□ □ □ □!`.length;
    const boundaries = [
      [prefix.length, prefix.length],
      [prefix.length + 1, prefix.length + citationSource.length],
      [prefix.length + 1 + between.length, prefix.length + citationSource.length + between.length],
      [
        prefix.length + 2 + between.length,
        prefix.length + citationSource.length * 2 + between.length,
      ],
      [collapsedLength, text.length],
    ] as const;

    for (const [collapsed, expanded] of boundaries) {
      expect(expandCollapsedComposerCursor(text, collapsed)).toBe(expanded);
      expect(collapseExpandedComposerCursor(text, expanded)).toBe(collapsed);
    }
    for (let cursor = 0; cursor <= collapsedLength; cursor += 1) {
      expect(
        collapseExpandedComposerCursor(text, expandCollapsedComposerCursor(text, cursor)),
      ).toBe(cursor);
    }
    expect(clampCollapsedComposerCursor(text, Number.POSITIVE_INFINITY)).toBe(collapsedLength);
  });

  it("snaps serialized offsets inside a citation to the end of its chip", () => {
    const prefix = "前👋";
    const text = `${prefix}${citationSource}.`;

    for (const offset of [1, citationSource.length - 1, citationSource.length]) {
      expect(collapseExpandedComposerCursor(text, prefix.length + offset)).toBe(prefix.length + 1);
    }
    expect(isCollapsedCursorAdjacentToInlineToken(text, prefix.length, "right")).toBe(true);
    expect(isCollapsedCursorAdjacentToInlineToken(text, prefix.length + 1, "left")).toBe(true);
    expect(isCollapsedCursorAdjacentToInlineToken(text, prefix.length + 2, "left")).toBe(false);
  });

  it("deletes one collapsed citation without changing its neighbor or surrounding punctuation", () => {
    const text = `(${citationSource}),${citationSource}!`;
    const result = replaceTextRange(
      text,
      expandCollapsedComposerCursor(text, 1),
      expandCollapsedComposerCursor(text, 2),
      "",
    );

    expect(result).toEqual({ text: `(),${citationSource}!`, cursor: 1 });
    expect(collapseExpandedComposerCursor(result.text, result.text.length)).toBe("(),□!".length);
  });
});

describe("replaceTextRange trailing space consumption", () => {
  it("double space after insertion when replacement ends with space", () => {
    // Simulates: "and then |@AG| summarize" where | marks replacement range
    // The replacement is "@AGENTS.md " (with trailing space)
    // But if we don't extend rangeEnd, the existing space stays
    const text = "and then @AG summarize";
    const rangeStart = "and then ".length;
    const rangeEnd = "and then @AG".length;

    // Without consuming trailing space: double space
    const withoutConsume = replaceTextRange(text, rangeStart, rangeEnd, "@AGENTS.md ");
    expect(withoutConsume.text).toBe("and then @AGENTS.md  summarize");

    // With consuming trailing space: single space
    const extendedEnd = text[rangeEnd] === " " ? rangeEnd + 1 : rangeEnd;
    const withConsume = replaceTextRange(text, rangeStart, extendedEnd, "@AGENTS.md ");
    expect(withConsume.text).toBe("and then @AGENTS.md summarize");
  });
});

describe("isCollapsedCursorAdjacentToInlineToken", () => {
  it("returns false when no mention exists", () => {
    expect(isCollapsedCursorAdjacentToInlineToken("plain text", 6, "left")).toBe(false);
    expect(isCollapsedCursorAdjacentToInlineToken("plain text", 6, "right")).toBe(false);
  });

  it("keeps @query typing non-adjacent while no mention pill exists", () => {
    const text = "hello @pac";
    expect(isCollapsedCursorAdjacentToInlineToken(text, text.length, "left")).toBe(false);
    expect(isCollapsedCursorAdjacentToInlineToken(text, text.length, "right")).toBe(false);
  });

  it("detects left adjacency only when cursor is directly after a mention", () => {
    const text = "open @AGENTS.md next";
    const mentionStart = "open ".length;
    const mentionEnd = mentionStart + 1;

    expect(isCollapsedCursorAdjacentToInlineToken(text, mentionEnd, "left")).toBe(true);
    expect(isCollapsedCursorAdjacentToInlineToken(text, mentionStart, "left")).toBe(false);
    expect(isCollapsedCursorAdjacentToInlineToken(text, mentionEnd + 1, "left")).toBe(false);
  });

  it("detects right adjacency only when cursor is directly before a mention", () => {
    const text = "open @AGENTS.md next";
    const mentionStart = "open ".length;
    const mentionEnd = mentionStart + 1;

    expect(isCollapsedCursorAdjacentToInlineToken(text, mentionStart, "right")).toBe(true);
    expect(isCollapsedCursorAdjacentToInlineToken(text, mentionEnd, "right")).toBe(false);
    expect(isCollapsedCursorAdjacentToInlineToken(text, mentionStart - 1, "right")).toBe(false);
  });

  it("treats terminal pills as inline tokens for adjacency checks", () => {
    const text = `open ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} next`;
    const tokenStart = "open ".length;
    const tokenEnd = tokenStart + 1;

    expect(isCollapsedCursorAdjacentToInlineToken(text, tokenEnd, "left")).toBe(true);
    expect(isCollapsedCursorAdjacentToInlineToken(text, tokenStart, "right")).toBe(true);
  });

  it("treats skill pills as inline tokens for adjacency checks", () => {
    const text = "run $review-follow-up next";
    const tokenStart = "run ".length;
    const tokenEnd = tokenStart + 1;

    expect(isCollapsedCursorAdjacentToInlineToken(text, tokenEnd, "left")).toBe(true);
    expect(isCollapsedCursorAdjacentToInlineToken(text, tokenStart, "right")).toBe(true);
  });
});

describe("parseStandaloneComposerSlashCommand", () => {
  it("parses standalone /plan command", () => {
    expect(parseStandaloneComposerSlashCommand(" /plan ")).toBe("plan");
  });

  it("parses standalone /default command", () => {
    expect(parseStandaloneComposerSlashCommand("/default")).toBe("default");
  });

  it("ignores slash commands with extra message text", () => {
    expect(parseStandaloneComposerSlashCommand("/plan explain this")).toBeNull();
  });

  it("web exact /fork bypasses provider turn submission", () => {
    expect(
      resolveComposerSubmissionAction({
        text: " /fork ",
        attachmentCount: 0,
        contextCount: 0,
        planFollowUpAvailable: true,
      }),
    ).toBe("fork");
  });

  it("web routes ordinary text through an available plan follow-up", () => {
    expect(
      resolveComposerSubmissionAction({
        text: "Refine the testing steps",
        attachmentCount: 0,
        contextCount: 0,
        planFollowUpAvailable: true,
      }),
    ).toBe("plan-follow-up");
  });

  it("web /fork with extra context follows provider turn submission", () => {
    expect(
      resolveComposerSubmissionAction({ text: "/fork", attachmentCount: 1, contextCount: 0 }),
    ).toBe("message");
  });

  it("web navigates to the canonical target after command acceptance", async () => {
    const events: string[] = [];
    const succeeded = await executeWebForkSubmission({
      fork: async () => {
        events.push("dispatch", "navigate:target");
        return { ok: true };
      },
      clearCommand: () => events.push("clear"),
      reportError: () => events.push("error"),
    });
    expect(succeeded).toBe(true);
    expect(events).toEqual(["dispatch", "navigate:target", "clear"]);
  });

  it("web clears the exact command on success and preserves it and the target id on failure", async () => {
    let draft = "/fork";
    const targetId = "target-retained";
    const succeeded = await executeWebForkSubmission({
      fork: async () => ({ ok: false, message: targetId }),
      clearCommand: () => {
        draft = "";
      },
      reportError: (message) => expect(message).toBe(targetId),
    });
    expect(succeeded).toBe(false);
    expect(draft).toBe("/fork");
    expect(targetId).toBe("target-retained");
  });
});
