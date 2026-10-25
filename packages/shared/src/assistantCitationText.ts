import { ASSISTANT_CITATION_CONTEXT_LENGTH } from "@t3tools/contracts";

export type AssistantTextSelector = {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly prefix: string;
  readonly suffix: string;
};

/** Self-contained so the sandbox bridge can use exactly the same quote matching rules. */
export function createAssistantCitationTextTools(
  contextLength = ASSISTANT_CITATION_CONTEXT_LENGTH,
) {
  /** Keeps quote positions independent of HTML whitespace formatting. */
  function normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, " ");
  }

  /** Prevents truncating a Unicode character when bounding surrounding context. */
  function splitsSurrogatePair(text: string, offset: number): boolean {
    const before = text.charCodeAt(offset - 1);
    const after = text.charCodeAt(offset);
    return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
  }

  /** Saves the exact quote with normalized positions and bounded neighboring text. */
  function createAssistantTextSelector(
    text: string,
    rawStart: number,
    rawEnd: number,
  ): AssistantTextSelector | null {
    const quote = text.slice(rawStart, rawEnd);
    if (quote.trim().length === 0) return null;

    const normalized = normalizeWhitespace(text);
    let start = normalizeWhitespace(text.slice(0, rawStart)).length;
    if (rawStart > 0 && /\s/.test(text[rawStart - 1]!) && /\s/.test(text[rawStart]!)) {
      start -= 1;
    }
    const end = normalizeWhitespace(text.slice(0, rawEnd)).length;
    let prefixStart = Math.max(0, start - contextLength);
    let suffixEnd = Math.min(normalized.length, end + contextLength);
    // A split pair becomes a replacement character when the context enters a URL.
    if (splitsSurrogatePair(normalized, prefixStart)) prefixStart += 1;
    if (splitsSurrogatePair(normalized, suffixEnd)) suffixEnd -= 1;
    return {
      text: quote,
      start,
      end,
      prefix: normalized.slice(prefixStart, start),
      suffix: normalized.slice(end, suffixEnd),
    };
  }

  /**
   * All positions and context lengths use UTF-16 units in that normalized stream,
   * not markdown offsets or Unicode code points. Even matching saved offsets cannot
   * break a context tie, since those offsets may have drifted.
   */
  function findAssistantCitationText(
    text: string,
    selector: AssistantTextSelector,
  ): { start: number; end: number } | null {
    const normalized = normalizeWhitespace(text);
    const quote = normalizeWhitespace(selector.text);
    if (quote.trim().length === 0) return null;

    const prefix = normalizeWhitespace(selector.prefix);
    const suffix = normalizeWhitespace(selector.suffix);
    const matchesContext = (start: number, end: number) =>
      normalized.slice(Math.max(0, start - prefix.length), start) === prefix &&
      normalized.slice(end, end + suffix.length) === suffix;

    let match =
      Number.isSafeInteger(selector.start) &&
      Number.isSafeInteger(selector.end) &&
      selector.start >= 0 &&
      selector.end - selector.start === quote.length &&
      normalized.slice(selector.start, selector.end) === quote &&
      matchesContext(selector.start, selector.end)
        ? { start: selector.start, end: selector.end }
        : null;
    let onlyQuote: { start: number; end: number } | null = null;
    let quoteCount = 0;

    for (
      let start = normalized.indexOf(quote);
      start !== -1;
      start = normalized.indexOf(quote, start + 1)
    ) {
      const end = start + quote.length;
      quoteCount += 1;
      onlyQuote = { start, end };
      if (!matchesContext(start, end)) continue;
      if (match !== null && match.start !== start) return null;
      match = { start, end };
    }

    return match ?? (quoteCount === 1 ? onlyQuote : null);
  }

  return { createAssistantTextSelector, findAssistantCitationText };
}

export const { createAssistantTextSelector, findAssistantCitationText } =
  createAssistantCitationTextTools();
