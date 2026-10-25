import { describe, expect, it } from "vite-plus/test";
import { injectHtmlRenderCitationBridge, readHtmlCitationMessage } from "./htmlRenderCitation.ts";

const selection = {
  type: "t3-html-citation",
  action: "selection",
  selector: { text: "A quote", start: 3, end: 10, prefix: "Hi ", suffix: "." },
  rect: { left: 10, top: 20, right: 70, bottom: 40 },
  width: 600,
  height: 400,
};

describe("HTML citation bridge", () => {
  it("accepts bounded rendered selections and rejects invalid quote positions and geometry", () => {
    expect(readHtmlCitationMessage(selection)).toEqual(selection);
    for (const invalid of [
      { ...selection, width: -1 },
      { ...selection, rect: { ...selection.rect, top: Infinity } },
      { ...selection, selector: { ...selection.selector, text: "x".repeat(8002) } },
      { ...selection, selector: { ...selection.selector, start: 15 } },
      { ...selection, selector: { ...selection.selector, end: Number.MAX_SAFE_INTEGER + 1 } },
      { ...selection, selector: { ...selection.selector, text: " " } },
    ])
      expect(readHtmlCitationMessage(invalid)).toBeUndefined();
  });

  it("preserves the doctype and original source when adding support to a saved preview", () => {
    const prefix = "\uFEFF<!-- saved -->\n<!doctype html>";
    const html = `${prefix}<html><body><p>A quote</p></body></html>`;
    const transformed = injectHtmlRenderCitationBridge(html);
    expect(transformed.startsWith(`${prefix}<script id="t3-citations">`)).toBe(true);
    expect(transformed.endsWith("<html><body><p>A quote</p></body></html>")).toBe(true);
  });
});
