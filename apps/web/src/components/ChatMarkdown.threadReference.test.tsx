import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { describe, expect, it } from "vite-plus/test";

import {
  CHAT_MARKDOWN_SANITIZE_SCHEMA,
  chatMarkdownUrlTransform,
  rehypeTagThreadReferenceLinks,
  resolveChatMarkdownThreadReference,
} from "./ChatMarkdown";

const components: Components = {
  a({ node, href, children }) {
    const resolution = resolveChatMarkdownThreadReference(
      href,
      node?.properties?.dataThreadReferenceHref ?? node?.properties?.href,
    );
    if (resolution?.kind === "thread") {
      return <span data-thread-reference={resolution.href}>{children}</span>;
    }
    if (resolution?.kind === "invalid") {
      return <span data-invalid-thread-reference="true">{children}</span>;
    }
    return <a href={href}>{children}</a>;
  },
};

function renderMarkdown(markdown: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown
      rehypePlugins={[
        rehypeRaw,
        rehypeTagThreadReferenceLinks,
        [rehypeSanitize, CHAT_MARKDOWN_SANITIZE_SCHEMA],
      ]}
      components={components}
      urlTransform={chatMarkdownUrlTransform}
    >
      {markdown}
    </ReactMarkdown>,
  );
}

describe("ChatMarkdown thread references", () => {
  it("preserves a canonical URI through sanitization for thread rendering", () => {
    const markup = renderMarkdown("[Target](t3code://threads/local/thread-1)");

    expect(markup).toContain('data-thread-reference="t3code://threads/local/thread-1"');
    expect(markup).not.toContain('href="t3code:');
  });

  it.each([
    "t3code://other/local/thread-1",
    "T3CODE://threads/local/thread-1",
    "t3code://threads/local/thread-1?view=full",
    "t3code://user@threads/local/thread-1",
    "t3code://threads/local/thread-1/extra",
  ])("renders malformed custom destinations as inert text: %s", (destination) => {
    const markup = renderMarkdown(`[Target](${destination})`);

    expect(markup).toContain('data-invalid-thread-reference="true"');
    expect(markup).not.toContain("<a");
  });

  it("makes a malformed raw HTML custom link inert", () => {
    const markup = renderMarkdown('<a href="t3code://other/local/thread-1">Target</a>');

    expect(markup).toContain('data-invalid-thread-reference="true"');
    expect(markup).not.toContain("<a");
  });

  it("does not trust a raw HTML marker that disagrees with the actual destination", () => {
    const markup = renderMarkdown(
      '<a href="https://example.com" data-thread-reference-href="t3code://threads/local/thread-1">Target</a>',
    );

    expect(markup).toContain('<a href="https://example.com">Target</a>');
    expect(markup).not.toContain("data-thread-reference");
  });

  it.each([
    ["HTTP", "https://example.com/docs"],
    ["fragment", "#section"],
    ["mail", "mailto:user@example.com"],
    ["telephone", "tel:+12025550123"],
    ["file", "file:///tmp/example.ts"],
  ])("retains ordinary %s link behavior", (label, destination) => {
    const markup = renderMarkdown(`[${label}](${destination})`);

    expect(markup).toContain("<a");
    expect(markup).toContain(`${label}</a>`);
    expect(markup).not.toContain("data-thread-reference");
    expect(markup).not.toContain("data-invalid-thread-reference");
  });
});
