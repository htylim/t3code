import { EnvironmentId, ThreadId, type AssistantCitation } from "@t3tools/contracts";
import {
  expandAssistantCitationsForProvider,
  parseAssistantCitationHref,
  formatAssistantCitationHref,
  withAssistantCitationComment,
} from "@t3tools/shared/assistantCitations";
import { injectHtmlRenderCitationBridge } from "@t3tools/shared/htmlRenderCitation";
import { useRef, useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { act, render } from "../../../test/render";
import { HtmlCitationActions, type HtmlCitationContext } from "./HtmlCitationActions";
import { AssistantCitationChip } from "./AssistantCitationChip";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import "~/index.css";

const source = {
  kind: "html-attachment",
  environmentId: EnvironmentId.make("remote-environment"),
  threadId: ThreadId.make("source-thread"),
  itemId: "html-row",
  attachmentId: "saved-html",
  title: "Table and chart libraries",
} as const;
const html =
  injectHtmlRenderCitationBridge(`<!doctype html><p>Before. Use a native table. After.</p><button>Filter chart</button>
<script>
window.addEventListener("message", function(event) {
  if (event.data === "test-control") {
    var button = document.querySelector("button");
    button.dispatchEvent(new PointerEvent("pointerdown", {bubbles:true,button:0,isPrimary:true}));
    button.dispatchEvent(new PointerEvent("pointerup", {bubbles:true,button:0,isPrimary:true}));
    button.dispatchEvent(new MouseEvent("mouseup", {bubbles:true,button:0}));
    window.setTimeout(function(){window.parent.postMessage("test-control-complete", "*");},0);
    return;
  }
  if (event.data !== "test-select") return;
  var text = document.querySelector("p").firstChild;
  var range = document.createRange();
  range.setStart(text, 8); range.setEnd(text, 27);
  window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
});

</script>`);

/** Uses the actual sandbox bridge, including its serialized text matching code. */
function Preview({
  context,
  onLoad,
  documentHtml = html,
}: {
  context: HtmlCitationContext;
  onLoad: () => void;
  documentHtml?: string;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  return (
    <div data-assistant-citation-viewport="true" style={{ width: 600, height: 400 }}>
      <iframe
        ref={frameRef}
        title="Saved preview"
        srcDoc={documentHtml}
        sandbox="allow-scripts allow-forms"
        style={{ width: 600, height: 400 }}
        onLoad={() => {
          setLoaded(true);
          onLoad();
        }}
      />
      <HtmlCitationActions frameRef={frameRef} loaded={loaded} context={context} />
    </div>
  );
}

it("cites sandboxed HTML with durable attachment provenance and readable model context", async () => {
  const onCite = vi.fn<HtmlCitationContext["onCite"]>(() => true);
  const onLoad = vi.fn();
  await using screen = await render(<Preview context={{ source, onCite }} onLoad={onLoad} />);
  await vi.waitFor(() => expect(onLoad).toHaveBeenCalled());
  const frame = screen.container.querySelector("iframe")!;
  await act(async () => {
    frame.focus();
    frame.contentWindow!.postMessage("test-select", "*");
  });
  await expect
    .element(page.getByRole("button", { name: "Cite selection in composer" }))
    .toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Cite selection in composer" }));
  expect(onCite).toHaveBeenCalledOnce();
  const citation = onCite.mock.calls[0]![0];
  expect(citation).toMatchObject({ version: 2, source, text: "Use a native table." });
  expect(parseAssistantCitationHref(formatAssistantCitationHref(citation))).toEqual(citation);
  const delivered = expandAssistantCitationsForProvider(
    `[Assistant quote](${formatAssistantCitationHref(citation)})`,
  );
  expect(delivered).toContain('"kind": "html-attachment"');
  expect(delivered).toContain('"attachmentId": "saved-html"');
  expect(delivered).toContain('"text": "Use a native table."');
  expect(delivered).not.toContain("t3-citation://");
});

it("keeps citation support when a visualization replaces its document", async () => {
  const onCite = vi.fn<HtmlCitationContext["onCite"]>(() => true);
  const onLoad = vi.fn();
  const replacement = html.replace(/<script id="t3-citations">[\s\S]*?<\/script>/, "");
  const wrapper = injectHtmlRenderCitationBridge(`<!doctype html><script>
    window.addEventListener("message", function(event) {
      if (event.data !== "test-replace") return;
      document.open(); document.write(${JSON.stringify(replacement).replace(/</g, "\\u003c")}); document.close();
    });
  </script>`);
  await using screen = await render(
    <Preview context={{ source, onCite }} onLoad={onLoad} documentHtml={wrapper} />,
  );
  await vi.waitFor(() => expect(onLoad).toHaveBeenCalled());
  const frame = screen.container.querySelector("iframe")!;
  await act(async () => frame.contentWindow!.postMessage("test-replace", "*"));
  await vi.waitFor(() => expect(onLoad).toHaveBeenCalledTimes(2));
  await act(async () => {
    frame.focus();
    frame.contentWindow!.postMessage("test-select", "*");
  });
  await expect
    .element(page.getByRole("button", { name: "Cite selection in composer" }))
    .toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Cite selection in composer" }));
  expect(onCite.mock.calls[0]?.[0]).toMatchObject({ source, text: "Use a native table." });
});

it("reveals a saved quote after reloading its attachment", async () => {
  const onReveal = vi.fn();
  const onLoad = vi.fn();
  const citation: AssistantCitation = {
    version: 2,
    source,
    text: "Use a native table.",
    start: 8,
    end: 27,
    prefix: "Before. ",
    suffix: " After.",
  };
  const request = {
    citation,
    key: "reveal-saved-quote",
    activationRef: { current: { scrolled: false, dismissed: false } },
    onComplete: vi.fn(),
  };
  await using _screen = await render(
    <Preview context={{ source, onCite: () => true, request, onReveal }} onLoad={onLoad} />,
  );
  await vi.waitFor(() => expect(onReveal).toHaveBeenCalledWith(expect.any(DOMRect), true));
});

it("keeps the HTML quote and user comment together in the ordinary Cite chip", async () => {
  const onLoad = vi.fn();
  /** Uses the ordinary chip and comment editor with a captured iframe source. */
  function QuotedPreview() {
    const [selected, setSelected] = useState<{
      citation: AssistantCitation;
      anchor?: AssistantCitationSourceAnchor | undefined;
    } | null>(null);
    const [open, setOpen] = useState(false);
    return (
      <>
        <Preview
          onLoad={onLoad}
          context={{
            source,
            onCite: (citation, anchor) => {
              setSelected({ citation, anchor });
              setOpen(true);
              return true;
            },
          }}
        />
        {selected ? (
          <>
            <output>{formatAssistantCitationHref(selected.citation)}</output>
            <AssistantCitationChip
              citation={selected.citation}
              composer
              commentEditor={{
                open,
                onOpenChange: setOpen,
                sourceAnchor: selected.anchor,
                onSave: (comment) => {
                  setSelected({
                    ...selected,
                    citation: withAssistantCitationComment(selected.citation, comment),
                  });
                  return true;
                },
              }}
            />
          </>
        ) : null}
      </>
    );
  }
  await using screen = await render(<QuotedPreview />);
  await vi.waitFor(() => expect(onLoad).toHaveBeenCalled());
  const frame = screen.container.querySelector("iframe")!;
  await act(async () => {
    frame.focus();
    frame.contentWindow!.postMessage("test-select", "*");
  });
  await expect
    .element(page.getByRole("button", { name: "Cite selection in composer" }))
    .toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Cite selection in composer" }));
  const comment = page.getByRole("textbox", { name: "Comment on selected text" });
  await expect.element(comment).toBeVisible();
  await userEvent.click(comment);
  await userEvent.keyboard("Why this library?{Enter}");
  const citation = parseAssistantCitationHref(
    screen.container.querySelector("output")!.textContent!,
  );
  expect(citation).toMatchObject({
    version: 2,
    source,
    text: "Use a native table.",
    comment: "Why this library?",
  });
});

it("keeps the saved quote when the attachment no longer contains that passage", async () => {
  const onReveal = vi.fn();
  const citation: AssistantCitation = {
    version: 2,
    source,
    text: "This passage was removed.",
    start: 0,
    end: 25,
    prefix: "",
    suffix: "",
  };
  const request = {
    citation,
    key: "missing-quote",
    activationRef: { current: { scrolled: false, dismissed: false } },
    onComplete: vi.fn(),
  };
  await using _screen = await render(
    <Preview context={{ source, onCite: () => true, request, onReveal }} onLoad={() => {}} />,
  );
  await vi.waitFor(() => expect(onReveal).toHaveBeenCalledWith(expect.any(DOMRect), false));
  expect(citation.text).toBe("This passage was removed.");
});

it("ignores selection messages that do not come from its own iframe", async () => {
  const onCite = vi.fn(() => true);
  await using screen = await render(<Preview context={{ source, onCite }} onLoad={() => {}} />);
  await act(async () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: {
          type: "t3-html-citation",
          action: "selection",
          selector: {
            text: "Wrong frame",
            start: 0,
            end: 11,
            prefix: "",
            suffix: "",
          },
          rect: { left: 0, right: 100, top: 0, bottom: 20 },
          width: 600,
          height: 400,
        },
      }),
    ),
  );
  await expect
    .element(page.getByRole("button", { name: "Cite selection in composer" }))
    .not.toBeInTheDocument();
  expect(onCite).not.toHaveBeenCalled();
});

it("dismisses selection actions when the reader uses a preview control", async () => {
  const onLoad = vi.fn();
  await using screen = await render(
    <Preview context={{ source, onCite: () => true }} onLoad={onLoad} />,
  );
  await vi.waitFor(() => expect(onLoad).toHaveBeenCalled());
  const frame = screen.container.querySelector("iframe")!;
  await act(async () => {
    frame.focus();
    frame.contentWindow!.postMessage("test-select", "*");
  });
  await expect
    .element(page.getByRole("button", { name: "Cite selection in composer" }))
    .toBeVisible();
  await act(async () => {
    await new Promise<void>((resolve) => {
      const complete = (event: MessageEvent) => {
        if (event.source !== frame.contentWindow || event.data !== "test-control-complete") return;
        window.removeEventListener("message", complete);
        resolve();
      };
      window.addEventListener("message", complete);
      frame.contentWindow!.postMessage("test-control", "*");
    });
  });
  await expect
    .element(page.getByRole("button", { name: "Cite selection in composer" }))
    .not.toBeInTheDocument();
});
