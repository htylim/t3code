import { describe, expect, it } from "vite-plus/test";
import remarkParse from "remark-parse";
import { unified } from "unified";

import {
  remarkCodexDirectives,
  renderCodexDirectivesForCopy,
  renderCodexFileCitationsAsMarkdown,
  splitCodexArtifactTemplateMarkdown,
} from "./codexMarkdownDirectives.js";

interface TestNode {
  readonly type: string;
  readonly value?: string;
  readonly url?: string;
  readonly position?: {
    readonly start: { readonly offset?: number };
    readonly end: { readonly offset?: number };
  };
  readonly data?: {
    readonly hName?: string;
    readonly hProperties?: Readonly<Record<string, unknown>>;
  };
  readonly children?: readonly TestNode[];
}

const FILE_CITATION = ':codex-file-citation{path="outputs/report.xlsx" purpose="output"}';
const VISUALIZATION_PATH = "/workspace/.t3/visualizations/side-surface-icons.html";
const VISUALIZATION = `\uE200visualize\uE202${JSON.stringify({ path: VISUALIZATION_PATH })}\uE201`;
const ARTIFACT_TEMPLATE =
  '::artifact-template{skill_name="artifact-template-hello-world" skill_directory="/Users/test/.codex/skills/artifact-template-hello-world" display_name="Hello World" artifact_kind="document"}';

function parse(markdown: string): TestNode {
  const processor = unified().use(remarkParse).use(remarkCodexDirectives);
  return processor.runSync(processor.parse(markdown), { value: markdown }) as TestNode;
}

function parseOrdinaryMarkdown(markdown: string): TestNode {
  return unified().use(remarkParse).parse(markdown) as TestNode;
}

describe("remarkCodexDirectives", () => {
  it("renders a file citation as a link without changing its source position", () => {
    const markdown = `Created ${FILE_CITATION}.`;
    const link = parse(markdown).children?.[0]?.children?.[1];

    expect(link).toMatchObject({
      type: "link",
      url: "outputs/report.xlsx",
      children: [{ type: "text", value: "report.xlsx" }],
      position: {
        start: { offset: markdown.indexOf(FILE_CITATION) },
        end: { offset: markdown.indexOf(FILE_CITATION) + FILE_CITATION.length },
      },
    });
  });

  it("renders an artifact template as semantic block metadata", () => {
    expect(parse(ARTIFACT_TEMPLATE).children?.[0]).toMatchObject({
      type: "paragraph",
      children: [],
      data: {
        hName: "div",
        hProperties: {
          dataCodexArtifactTemplate: "true",
          dataArtifactKind: "document",
          dataDisplayName: "Hello World",
          dataSkillName: "artifact-template-hello-world",
        },
      },
    });
  });

  it("renders a visualization marker as a file link with its original source position", () => {
    const markdown = `Compare these options:\n\n${VISUALIZATION}\n\nChoose one.`;

    expect(parse(markdown).children?.[1]?.children).toEqual([
      expect.objectContaining({
        type: "link",
        url: VISUALIZATION_PATH,
        children: [{ type: "text", value: "side-surface-icons.html" }],
        position: {
          start: { line: 3, column: 1, offset: markdown.indexOf(VISUALIZATION) },
          end: {
            line: 3,
            column: VISUALIZATION.length + 1,
            offset: markdown.indexOf(VISUALIZATION) + VISUALIZATION.length,
          },
        },
      }),
    ]);
  });

  it.each([
    "Meeting at 10:30",
    "Open src/main.ts:42",
    "Use :hover and :tada:",
    "::note",
    ":::note\ncontent\n:::",
    ':codex-file-citation-extra{path="outputs/report.xlsx"}',
    "::artifact-template-extra",
  ])("does not change unrelated colon syntax: %s", (markdown) => {
    expect(parse(markdown)).toEqual(parseOrdinaryMarkdown(markdown));
  });

  it.each([
    ':codex-file-citation{purpose="output"}',
    '::artifact-template{skill_name="artifact-template-hello-world"}',
  ])("keeps malformed supported directives literal: %s", (markdown) => {
    expect(parse(markdown)).toEqual(parseOrdinaryMarkdown(markdown));
  });
});

describe("native Markdown adapters", () => {
  it("uses the same parser to render file citations as portable links", () => {
    expect(renderCodexFileCitationsAsMarkdown(`Created ${FILE_CITATION}.`)).toBe(
      "Created [report.xlsx](<outputs/report.xlsx>).",
    );
  });

  it.each([
    `\\${FILE_CITATION}`,
    `\`${FILE_CITATION}\``,
    `\`\`\`text\n${FILE_CITATION}\n\`\`\``,
    `[See ${FILE_CITATION}](https://example.com)`,
  ])("does not render excluded citation syntax: %s", (markdown) => {
    expect(renderCodexFileCitationsAsMarkdown(markdown)).toBe(markdown);
  });

  it("renders visualization links alongside file citations", () => {
    expect(renderCodexFileCitationsAsMarkdown(`See ${VISUALIZATION} and ${FILE_CITATION}.`)).toBe(
      `See [side-surface-icons.html](<${VISUALIZATION_PATH}>) and [report.xlsx](<outputs/report.xlsx>).`,
    );
  });

  it.each([
    [
      "/workspace/reports/*draft*_[copy]`<& 100% #1?.html",
      "[\\*draft\\*\\_\\[copy\\]\\`\\<\\& 100% #1?.html](</workspace/reports/*draft*_[copy]`%3C& 100%25 %231%3F.html>)",
    ],
    ["C:\\Users\\test\\diagram.html", "[diagram.html](<C:\\Users\\test\\diagram.html>)"],
    ['/workspace/quoted"file.html', '[quoted"file.html](</workspace/quoted"file.html>)'],
  ])("preserves JSON and Markdown characters in visualization paths: %s", (path, expected) => {
    const marker = `\uE200visualize\uE202${JSON.stringify({ path })}\uE201`;
    expect(renderCodexFileCitationsAsMarkdown(marker)).toBe(expected);
  });

  it.each([
    `\`${VISUALIZATION}\``,
    `\`\`\`text\n${VISUALIZATION}\n\`\`\``,
    `    ${VISUALIZATION}`,
    `[See ${VISUALIZATION}](https://example.com)`,
    `[${VISUALIZATION}][example]\n\n[example]: https://example.com`,
    "\uE200visualize\uE202not-json\uE201",
    "\uE200visualize\uE202null\uE201",
    "\uE200visualize\uE202[]\uE201",
    '\uE200visualize\uE202{"path":42}\uE201',
    '\uE200visualize\uE202{"path":" "}\uE201',
    '\uE200visualize\uE202{"title":"No path"}\uE201',
    VISUALIZATION.slice(0, -1),
    VISUALIZATION.replace("visualize", "visualize-extra"),
  ])("preserves excluded, invalid, and incomplete visualization markers: %s", (markdown) => {
    expect(renderCodexFileCitationsAsMarkdown(markdown)).toBe(markdown);
    expect(renderCodexDirectivesForCopy(markdown)).toBe(markdown);
  });

  it("does not swallow a complete visualization after an unfinished marker", () => {
    const unfinished = '\uE200visualize\uE202{"path":"';
    expect(renderCodexFileCitationsAsMarkdown(`${unfinished} ${VISUALIZATION}`)).toBe(
      `${unfinished} [side-surface-icons.html](<${VISUALIZATION_PATH}>)`,
    );
  });

  it("splits artifact cards from surrounding native Markdown", () => {
    expect(splitCodexArtifactTemplateMarkdown(`Before\n\n${ARTIFACT_TEMPLATE}\n\nAfter`)).toEqual([
      { kind: "markdown", markdown: "Before\n\n", sourceOffset: 0 },
      {
        kind: "artifact-template",
        sourceOffset: 8,
        template: {
          artifactKind: "document",
          displayName: "Hello World",
          skillDirectory: "/Users/test/.codex/skills/artifact-template-hello-world",
          skillName: "artifact-template-hello-world",
        },
      },
      {
        kind: "markdown",
        markdown: "\n\nAfter",
        sourceOffset: 8 + ARTIFACT_TEMPLATE.length,
      },
    ]);
  });

  it("leaves malformed and code artifact-template examples in Markdown", () => {
    const malformed = '::artifact-template{display_name="Hello World"}';
    const code = `\`${ARTIFACT_TEMPLATE}\``;
    expect(splitCodexArtifactTemplateMarkdown(malformed)).toEqual([
      { kind: "markdown", markdown: malformed, sourceOffset: 0 },
    ]);
    expect(splitCodexArtifactTemplateMarkdown(code)).toEqual([
      { kind: "markdown", markdown: code, sourceOffset: 0 },
    ]);
  });
});

describe("directive copy adapter", () => {
  it("copies visualization markers as portable file links", () => {
    expect(renderCodexDirectivesForCopy(`Options:\n\n${VISUALIZATION}`)).toBe(
      `Options:\n\n[side-surface-icons.html](<${VISUALIZATION_PATH}>)`,
    );
  });

  it("copies the Markdown representations shown by citation chips and template cards", () => {
    expect(renderCodexDirectivesForCopy(`Created ${FILE_CITATION}.\n\n${ARTIFACT_TEMPLATE}`)).toBe(
      "Created [report.xlsx](<outputs/report.xlsx>).\n\nHello World (Document template)",
    );
  });

  it("leaves excluded and malformed directive source unchanged", () => {
    const markdown = [
      `\`${FILE_CITATION}\``,
      '::artifact-template{display_name="Hello World"}',
    ].join("\n\n");

    expect(renderCodexDirectivesForCopy(markdown)).toBe(markdown);
  });
});
