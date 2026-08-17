import type { MermaidConfig } from "mermaid";

export type MermaidTheme = "light" | "dark";

interface MermaidRuntime {
  initialize(config: MermaidConfig): void;
  render(id: string, source: string): Promise<{ svg: string }>;
}

type LoadMermaidRuntime = () => Promise<MermaidRuntime>;

const MAX_MERMAID_TEXT_SIZE = 50_000;
const MAX_MERMAID_EDGES = 500;

export function mermaidConfig(theme: MermaidTheme): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    secure: [
      "secure",
      "securityLevel",
      "startOnLoad",
      "maxTextSize",
      "maxEdges",
      "suppressErrorRendering",
    ],
    suppressErrorRendering: true,
    maxTextSize: MAX_MERMAID_TEXT_SIZE,
    maxEdges: MAX_MERMAID_EDGES,
    theme: theme === "dark" ? "dark" : "default",
    htmlLabels: false,
    flowchart: {
      htmlLabels: false,
      useMaxWidth: false,
    },
  };
}

let renderSequence = 0;

/** Mermaid configuration is global, so renders with different themes must not overlap. */
export function createMermaidRenderer(loadRuntime: LoadMermaidRuntime) {
  let renderQueue: Promise<void> = Promise.resolve();

  return (source: string, theme: MermaidTheme): Promise<string> => {
    const render = async () => {
      const runtime = await loadRuntime();
      runtime.initialize(mermaidConfig(theme));
      renderSequence += 1;
      const result = await runtime.render(`t3-mermaid-${renderSequence}`, source);
      return result.svg;
    };

    const result = renderQueue.then(render, render);
    renderQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

let runtimePromise: Promise<MermaidRuntime> | null = null;

function loadMermaidRuntime(): Promise<MermaidRuntime> {
  runtimePromise ??= import("mermaid").then((module) => module.default);
  return runtimePromise.catch((cause: unknown) => {
    runtimePromise = null;
    throw cause;
  });
}

export const renderMermaid = createMermaidRenderer(loadMermaidRuntime);
