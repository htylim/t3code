import {
  ASSISTANT_CITATION_CONTEXT_LENGTH,
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { createAssistantCitationTextTools } from "./assistantCitationText.ts";

const Bounds = Schema.Struct({
  left: Schema.Finite,
  top: Schema.Finite,
  right: Schema.Finite,
  bottom: Schema.Finite,
});
const Selector = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_MAX_TEXT_LENGTH + 1)),
  start: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  end: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  prefix: Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_CONTEXT_LENGTH)),
  suffix: Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_CONTEXT_LENGTH)),
});
const BridgeMessage = Schema.Struct({
  type: Schema.Literal("t3-html-citation"),
  action: Schema.Literals(["selection", "dismiss", "ready", "revealed", "focus"]),
  selector: Schema.optional(Selector),
  rect: Schema.optional(Bounds),
  width: Schema.optional(Schema.Finite.check(Schema.isGreaterThan(0))),
  height: Schema.optional(Schema.Finite.check(Schema.isGreaterThan(0))),
  requestId: Schema.optional(Schema.String.check(Schema.isMaxLength(512))),
});
const decodeMessage = Schema.decodeUnknownOption(BridgeMessage);

/** Accepts bounded frame data; the host supplies all source identities itself. */
export function readHtmlCitationMessage(data: unknown) {
  const message = Option.getOrUndefined(decodeMessage(data));
  if (
    message?.selector &&
    (message.selector.end <= message.selector.start || !message.selector.text.trim())
  )
    return undefined;
  return message;
}

/** Runs without app imports inside an opaque-origin iframe. Selection never executes an app action. */
const HTML_CITATION_BRIDGE = String.raw`function installHtmlCitationBridge(textToolsFactory, contextLength, maxTextLength) {
    if (window.parent === window) return;
    const tools = textToolsFactory(contextLength);
    const excluded = "button,input,textarea,select,[role=button],[contenteditable],[hidden],[aria-hidden=true],script,style,template,noscript";
    const blocks = "address,article,aside,blockquote,dd,div,dl,dt,figcaption,figure,footer,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,td,th,tr,ul";
    let pointerDown = false;
    let gestureActive = false;
    let dismissed = false;
    let timer;
    let highlightTimer;
    let hasSelection = false;
    /** Reports frame coordinates; source identity always comes from the host. */
    function post(action, selector, range, requestId) {
        const bounds = range?.getBoundingClientRect();
        window.parent.postMessage({
            type: "t3-html-citation",
            action,
            selector,
            requestId,
            rect: bounds && {
                left: bounds.left,
                top: bounds.top,
                right: bounds.right,
                bottom: bounds.bottom
            },
            width: window.innerWidth,
            height: window.innerHeight
        }, "*");
    }
    /** Counts visible rendered text rather than HTML markup or control values. */
    function readText() {
        const chunks = [];
        let text = "";
        let separator = false;
        /** Adds block separators so adjacent paragraphs do not merge into one word. */
        function visit(node) {
            if (node.nodeType === 3) {
                const content = node.textContent ?? "";
                if (!content) return;
                if (separator && text.length > 0) text += "\n";
                separator = false;
                const start = text.length;
                text += content;
                chunks.push({
                    node: node,
                    start,
                    end: text.length
                });
                return;
            }
            if (node.nodeType !== 1) return;
            const element = node;
            if (element.matches(excluded)) return;
            const style = getComputedStyle(element);
            if (style.display === "none" || style.visibility === "hidden" || style.userSelect === "none") return;
            const block = element.matches(blocks) || element.tagName === "BR";
            if (block) separator = true;
            for (const child of element.childNodes)visit(child);
            if (block) separator = true;
        }
        if (document.body) visit(document.body);
        return {
            text,
            chunks
        };
    }
    /** Captures after selection settles, with one extra character to signal the size limit. */
    function reportSelection() {
        timer = undefined;
        if (pointerDown || dismissed) return;
        const selection = document.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount !== 1) {
            hasSelection = false;
            post("dismiss");
            return;
        }
        const range = selection.getRangeAt(0);
        const stream = readText();
        let start;
        let end = 0;
        for (const chunk of stream.chunks){
            if (!range.intersectsNode(chunk.node)) continue;
            const first = range.startContainer === chunk.node ? range.startOffset : 0;
            const last = range.endContainer === chunk.node ? range.endOffset : chunk.node.length;
            if (first === last) continue;
            start ??= chunk.start + first;
            end = chunk.start + last;
        }
        const selector = start === undefined ? null : tools.createAssistantTextSelector(stream.text, start, end);
        if (!selector) {
            hasSelection = false;
            post("dismiss");
            return;
        }
        hasSelection = true;
        post("selection", {
            ...selector,
            text: selector.text.slice(0, maxTextLength + 1)
        }, range);
    }
    /** Coalesces selection events and lets double/triple clicks finish. */
    function scheduleSelection(delay = 0) {
        window.clearTimeout(timer);
        timer = window.setTimeout(reportSelection, delay);
    }
    /** Finds a saved passage using the same stream and matching rules as capture. */
    function resolveRange(selector) {
        const stream = readText();
        const match = tools.findAssistantCitationText(stream.text, selector);
        if (!match) return null;
        /** Maps normalized UTF-16 positions back to the original text nodes. */
        function rawOffset(normalizedOffset) {
            let offset = 0;
            for (const part of stream.text.matchAll(/\s+|\S+/g)){
                const whitespace = /\s/.test(part[0][0]);
                const length = whitespace ? 1 : part[0].length;
                if (normalizedOffset <= offset + length) {
                    return part.index + (whitespace && normalizedOffset > offset ? part[0].length : normalizedOffset - offset);
                }
                offset += length;
            }
            return stream.text.length;
        }
        const start = rawOffset(match.start);
        const end = rawOffset(match.end);
        const first = stream.chunks.find((chunk)=>chunk.end > start);
        const last = stream.chunks.findLast((chunk)=>chunk.start < end);
        if (!first || !last) return null;
        const range = document.createRange();
        range.setStart(first.node, Math.max(0, start - first.start));
        range.setEnd(last.node, Math.min(last.node.length, end - last.start));
        return range;
    }
    /** Rebinds after compressed visualizations replace their document. */
    function attachListeners() {
        document.addEventListener("pointerdown", (event)=>{
            pointerDown = event.button === 0;
            const control = event.target instanceof Element && event.target.closest("button,input,textarea,select,[role=button],[contenteditable]");
            gestureActive = pointerDown && !control && !event.defaultPrevented;
            dismissed = !gestureActive;
            window.clearTimeout(timer);
            post("dismiss");
        }, true);
        window.addEventListener("pointerup", ()=>{
            pointerDown = false;
        });
        window.addEventListener("pointercancel", ()=>{
            pointerDown = false;
            gestureActive = false;
            dismissed = true;
            post("dismiss");
        });
        document.addEventListener("mouseup", (event)=>{
            pointerDown = false;
            if (event.button === 0 && gestureActive) scheduleSelection(event.detail >= 2 ? 500 : 0);
            gestureActive = false;
        });
        document.addEventListener("selectionchange", ()=>{
            if (!pointerDown && !dismissed) scheduleSelection();
        });
        document.addEventListener("keydown", (event)=>{
            if (event.key === "Escape") {
                dismissed = true;
                hasSelection = false;
                post("dismiss");
            } else if (event.key === "Tab" && hasSelection && !dismissed && !event.shiftKey) {
                event.preventDefault();
                post("focus");
            } else if (event.key !== "Tab") {
                dismissed = false;
            }
        });
        document.addEventListener("contextmenu", ()=>{
            dismissed = true;
            window.clearTimeout(timer);
            post("dismiss");
        });
        document.addEventListener("scroll", ()=>{
            post("dismiss");
            if (hasSelection && !dismissed) scheduleSelection(150);
        }, true);
        window.addEventListener("resize", ()=>{
            dismissed = true;
            post("dismiss");
        });
        window.addEventListener("message", (event)=>{
            if (event.source !== window.parent || event.data?.type !== "t3-html-citation-command") return;
            const { action, selector, requestId } = event.data;
            if (action === "clear-selection") {
                dismissed = true;
                hasSelection = false;
                document.getSelection()?.removeAllRanges();
                return;
            }
            if (action === "clear-highlight") {
                window.clearTimeout(highlightTimer);
                CSS.highlights?.delete("t3-html-citation");
                return;
            }
            if (action !== "reveal" && action !== "highlight" || !selector) return;
            const range = resolveRange(selector);
            if (range && typeof Highlight !== "undefined" && CSS.highlights) {
                window.clearTimeout(highlightTimer);
                CSS.highlights.set("t3-html-citation", new Highlight(range));
                if (action === "reveal") {
                    highlightTimer = window.setTimeout(()=>CSS.highlights.delete("t3-html-citation"), 3000);
                }
            }
            if (action === "reveal") {
                range?.startContainer.parentElement?.scrollIntoView({
                    block: "nearest",
                    inline: "nearest"
                });
                post("revealed", undefined, range ?? undefined, requestId);
            }
        });
        document.addEventListener("DOMContentLoaded", ()=>{
            const style = document.createElement("style");
            style.textContent = "::highlight(t3-html-citation){background:var(--accent-surface,#ffd966);color:var(--foreground,inherit)}";
            document.head.append(style);
            post("ready");
        });
    }
    attachListeners();
    const nativeOpen = document.open;
    /** Preserves document.open's native return value and restores the bridge listeners. */
    function reopenDocument(...args) {
        const opened = Reflect.apply(nativeOpen, document, args);
        window.clearTimeout(timer);
        window.clearTimeout(highlightTimer);
        hasSelection = false;
        pointerDown = false;
        gestureActive = false;
        dismissed = false;
        attachListeners();
        return opened;
    }
    document.open = reopenDocument;
}`;

/** Injects at serve time so existing saved HTML previews gain citation support too. */
export function injectHtmlRenderCitationBridge(html: string): string {
  const prefix = /^(?:\s|<!--[\s\S]*?(?:-->|$))*(?:<!doctype[^>]*>)?/i.exec(html)![0];
  const script = `(${HTML_CITATION_BRIDGE})(${createAssistantCitationTextTools.toString()},${ASSISTANT_CITATION_CONTEXT_LENGTH},${ASSISTANT_CITATION_MAX_TEXT_LENGTH});`;
  return `${prefix}<script id="t3-citations">${script}</script>${html.slice(prefix.length)}`;
}
