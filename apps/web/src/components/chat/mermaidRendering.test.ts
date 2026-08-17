import { describe, expect, it } from "vite-plus/test";

import { createMermaidRenderer, mermaidConfig } from "./mermaidRendering";

describe("Mermaid rendering", () => {
  it("locks untrusted diagrams to strict, bounded rendering", () => {
    expect(mermaidConfig("dark")).toMatchObject({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      maxTextSize: 50_000,
      maxEdges: 500,
      theme: "dark",
      htmlLabels: false,
      flowchart: {
        htmlLabels: false,
        useMaxWidth: false,
      },
    });
  });

  it("serializes renders because Mermaid configuration is global", async () => {
    const calls: string[] = [];
    const render = createMermaidRenderer(async () => ({
      initialize(config) {
        calls.push(`initialize:${config.theme}`);
      },
      async render(id, source) {
        calls.push(`render:${id}:${source}`);
        return { svg: `<svg>${source}</svg>` };
      },
    }));

    await Promise.all([render("first", "light"), render("second", "dark")]);

    expect(calls[0]).toBe("initialize:default");
    expect(calls[1]).toMatch(/^render:t3-mermaid-\d+:first$/);
    expect(calls[2]).toBe("initialize:dark");
    expect(calls[3]).toMatch(/^render:t3-mermaid-\d+:second$/);
    expect(calls[1]).not.toBe(calls[3]);
  });

  it("continues rendering after an invalid diagram", async () => {
    let attempt = 0;
    const render = createMermaidRenderer(async () => ({
      initialize() {},
      async render(_id, source) {
        attempt += 1;
        if (attempt === 1) throw new Error("invalid diagram");
        return { svg: `<svg>${source}</svg>` };
      },
    }));

    await expect(render("broken", "light")).rejects.toThrow("invalid diagram");
    await expect(render("valid", "light")).resolves.toBe("<svg>valid</svg>");
  });
});
