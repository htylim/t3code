import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  MermaidDiagram,
  mermaidFenceMarkdown,
  mermaidPanPosition,
  shouldStartMermaidPan,
  stepMermaidZoom,
} from "./MermaidDiagram";

describe("MermaidDiagram", () => {
  it("preserves the source as a Mermaid fence for selection and copy", () => {
    expect(mermaidFenceMarkdown("flowchart TD\nA-->B\n")).toBe(
      "```mermaid\nflowchart TD\nA-->B\n```\n\n",
    );
  });

  it("uses a longer fence when the source contains backtick fences", () => {
    expect(mermaidFenceMarkdown("flowchart TD\nA[```]")).toBe(
      "````mermaid\nflowchart TD\nA[```]\n````\n\n",
    );
  });

  it("steps and clamps diagram zoom", () => {
    expect(stepMermaidZoom(100, -1)).toBe(75);
    expect(stepMermaidZoom(100, 1)).toBe(125);
    expect(stepMermaidZoom(25, -1)).toBe(25);
    expect(stepMermaidZoom(200, 1)).toBe(200);
  });

  it("starts primary-button panning outside diagram text", () => {
    const shape = {
      closest: () => null,
    } as unknown as EventTarget;

    expect(
      shouldStartMermaidPan({ button: 0, isPrimary: true, pointerType: "mouse", target: shape }),
    ).toBe(true);
    expect(
      shouldStartMermaidPan({ button: 1, isPrimary: true, pointerType: "mouse", target: shape }),
    ).toBe(false);
    expect(
      shouldStartMermaidPan({ button: 0, isPrimary: false, pointerType: "mouse", target: shape }),
    ).toBe(false);
    expect(
      shouldStartMermaidPan({ button: 0, isPrimary: true, pointerType: "touch", target: shape }),
    ).toBe(false);
  });

  it("leaves SVG and HTML Mermaid labels selectable", () => {
    const label = {
      closest: (selector: string) => (selector === "text, foreignObject" ? {} : null),
    } as unknown as EventTarget;

    expect(
      shouldStartMermaidPan({ button: 0, isPrimary: true, pointerType: "mouse", target: label }),
    ).toBe(false);
  });

  it("moves both scroll axes opposite the pointer drag", () => {
    expect(
      mermaidPanPosition({
        startLeft: 240,
        startTop: 180,
        startX: 100,
        startY: 80,
        currentX: 70,
        currentY: 120,
      }),
    ).toEqual({ left: 270, top: 140 });
  });

  it("server-renders the source fallback without loading Mermaid", () => {
    const markup = renderToStaticMarkup(
      <MermaidDiagram
        source={"flowchart TD\nA-->B\n"}
        theme="light"
        fallback={<pre>flowchart TD\nA--&gt;B</pre>}
      />,
    );

    expect(markup).toContain("data-markdown-copy=");
    expect(markup).toContain("flowchart TD");
    expect(markup).not.toContain("data-mermaid-diagram");
  });
});
