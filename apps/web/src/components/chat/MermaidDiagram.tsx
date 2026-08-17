import { CheckIcon, CopyIcon, Maximize2Icon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { Button } from "~/components/ui/button";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import { renderMermaid, type MermaidTheme } from "./mermaidRendering";

interface MermaidDiagramProps {
  readonly source: string;
  readonly theme: MermaidTheme;
  readonly fallback: ReactNode;
}

type RenderState =
  | { readonly key: string; readonly status: "ready"; readonly svg: string }
  | { readonly key: string; readonly status: "failed" }
  | { readonly key: string; readonly status: "loading" };

const MERMAID_ZOOM_MIN = 25;
const MERMAID_ZOOM_MAX = 200;
const MERMAID_ZOOM_STEP = 25;

export function stepMermaidZoom(zoom: number, direction: -1 | 1): number {
  return Math.min(
    MERMAID_ZOOM_MAX,
    Math.max(MERMAID_ZOOM_MIN, zoom + direction * MERMAID_ZOOM_STEP),
  );
}

export function mermaidFenceMarkdown(source: string): string {
  const code = source.replace(/\n$/, "");
  const longestBacktickRun = Math.max(0, ...(code.match(/`{3,}/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return `${fence}mermaid\n${code}\n${fence}\n\n`;
}

function MermaidSvg({
  svg,
  expanded,
  zoom,
}: {
  readonly svg: string;
  readonly expanded: boolean;
  readonly zoom: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fitSize, setFitSize] = useState<{ readonly height: number; readonly width: number }>();

  useLayoutEffect(() => {
    const container = containerRef.current;
    const viewport = container?.parentElement;
    const diagram = container?.querySelector("svg");
    if (!container || !viewport || !(diagram instanceof SVGSVGElement)) return;

    const viewBox = diagram.viewBox.baseVal;
    if (viewBox.width <= 0 || viewBox.height <= 0) return;

    const updateFitSize = () => {
      const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      const padding = expanded ? 48 : 32;
      const availableWidth = Math.max(1, viewport.clientWidth - padding);
      const availableHeight = Math.max(
        1,
        (expanded ? viewport.clientHeight : 32 * rootFontSize) - padding,
      );
      const scale = Math.min(1, availableWidth / viewBox.width, availableHeight / viewBox.height);
      setFitSize({ height: viewBox.height * scale, width: viewBox.width * scale });
    };

    updateFitSize();
    const resizeObserver = new ResizeObserver(updateFitSize);
    resizeObserver.observe(viewport);
    return () => resizeObserver.disconnect();
  }, [expanded, svg]);

  const zoomFactor = zoom / 100;

  return (
    <div
      ref={containerRef}
      className={expanded ? "min-h-full min-w-full w-max p-6" : "min-w-full w-max p-4"}
    >
      <div
        className="mx-auto [&_svg]:block [&_svg]:size-full"
        style={
          fitSize
            ? { height: fitSize.height * zoomFactor, width: fitSize.width * zoomFactor }
            : { visibility: "hidden" }
        }
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}

function MermaidZoomControls({
  zoom,
  setZoom,
}: {
  readonly zoom: number;
  readonly setZoom: Dispatch<SetStateAction<number>>;
}) {
  return (
    <span className="flex items-center gap-0.5" role="group" aria-label="Diagram zoom">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Zoom out Mermaid diagram"
              disabled={zoom === MERMAID_ZOOM_MIN}
              onClick={() => setZoom((current) => stepMermaidZoom(current, -1))}
            />
          }
        >
          <ZoomOutIcon className="size-3" />
        </TooltipTrigger>
        <TooltipPopup side="top">Zoom out</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="min-w-10 px-1 font-mono text-[0.625rem]"
              aria-label="Fit Mermaid diagram"
              onClick={() => setZoom(100)}
            />
          }
        >
          {zoom}%
        </TooltipTrigger>
        <TooltipPopup side="top">Fit diagram</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Zoom in Mermaid diagram"
              disabled={zoom === MERMAID_ZOOM_MAX}
              onClick={() => setZoom((current) => stepMermaidZoom(current, 1))}
            />
          }
        >
          <ZoomInIcon className="size-3" />
        </TooltipTrigger>
        <TooltipPopup side="top">Zoom in</TooltipPopup>
      </Tooltip>
    </span>
  );
}

export const MermaidDiagram = memo(function MermaidDiagram({
  source,
  theme,
  fallback,
}: MermaidDiagramProps) {
  const renderKey = `${theme}\u0000${source}`;
  const markdownCopy = useMemo(() => mermaidFenceMarkdown(source), [source]);
  const [renderState, setRenderState] = useState<RenderState>({
    key: renderKey,
    status: "loading",
  });
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(100);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: "Mermaid source",
  });

  useEffect(() => {
    let cancelled = false;
    setRenderState({ key: renderKey, status: "loading" });
    void renderMermaid(source, theme).then(
      (svg) => {
        if (!cancelled) setRenderState({ key: renderKey, status: "ready", svg });
      },
      (cause: unknown) => {
        if (cancelled) return;
        console.warn("[chat-mermaid] render failed", cause);
        setRenderState({ key: renderKey, status: "failed" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [renderKey, source, theme]);

  useEffect(() => {
    setExpanded(false);
    setZoom(100);
  }, [renderKey]);

  if (renderState.key !== renderKey || renderState.status !== "ready") {
    return (
      <div data-markdown-copy={markdownCopy}>
        {fallback}
        {renderState.key === renderKey && renderState.status === "failed" ? (
          <p className="mt-1 text-xs text-muted-foreground" role="status">
            Mermaid could not render this diagram. Showing its source instead.
          </p>
        ) : null}
      </div>
    );
  }

  const copyLabel = isCopied ? "Copied Mermaid source" : "Copy Mermaid source";

  return (
    <div
      className="my-[0.65rem] overflow-hidden rounded-[var(--radius)] border border-border/70 bg-secondary dark:border-transparent dark:bg-input/32"
      data-markdown-copy={markdownCopy}
      data-mermaid-diagram=""
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 select-none">
        <span className="px-1 font-mono text-[0.6875rem] text-muted-foreground">Mermaid</span>
        <span className="flex items-center gap-0.5" role="toolbar" aria-label="Diagram actions">
          <MermaidZoomControls zoom={zoom} setZoom={setZoom} />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={copyLabel}
                  onClick={() => copyToClipboard(source.replace(/\n$/, ""), undefined)}
                />
              }
            >
              {isCopied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            </TooltipTrigger>
            <TooltipPopup side="top">{copyLabel}</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Expand Mermaid diagram"
                  onClick={() => setExpanded(true)}
                />
              }
            >
              <Maximize2Icon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="top">Expand diagram</TooltipPopup>
          </Tooltip>
        </span>
      </div>
      <div className="max-h-[32rem] overflow-auto border-t border-border/60 bg-background">
        {expanded ? null : <MermaidSvg svg={renderState.svg} expanded={false} zoom={zoom} />}
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogPopup
          bottomStickOnMobile={false}
          className="flex h-[min(92vh,64rem)] w-[min(94vw,90rem)] max-w-none flex-col overflow-hidden p-0"
        >
          <DialogHeader className="shrink-0 flex-row items-center justify-between gap-2 border-b border-border/70 py-3 pr-14 pl-5">
            <DialogTitle className="text-base">Mermaid diagram</DialogTitle>
            <MermaidZoomControls zoom={zoom} setZoom={setZoom} />
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto bg-background">
            {expanded ? <MermaidSvg svg={renderState.svg} expanded zoom={zoom} /> : null}
          </div>
        </DialogPopup>
      </Dialog>
    </div>
  );
});
