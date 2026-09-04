import { describe, expect, it } from "vite-plus/test";

import source from "./CompactChatSurface.tsx?raw";

describe("side chat presentation parity", () => {
  it("uses the main chat timeline and composer instead of local presentation copies", () => {
    expect(source).toContain('from "~/components/chat/MessagesTimeline"');
    expect(source).toContain('from "~/components/chat/ChatComposer"');
    expect(source).toContain('from "~/components/chat/ComposerSurface"');
    expect(source).toContain("<MessagesTimeline");
    expect(source).toContain("<ChatComposer");
    expect(source).toContain("<ComposerSurface.Shell>");
    expect(source).toContain("<ComposerSurface.Host>");
    expect(source).not.toContain("chat-composer-glass-shell");
    expect(source).not.toContain("chat-composer-glass-host");
    expect(source).not.toContain("<ChatMarkdown");
    expect(source).not.toContain("<ComposerPromptEditor");
    expect(source).not.toContain("data-compact-chat-timeline");
  });

  it("matches the main composer footer footprint without rendering its context controls", () => {
    expect(source).toContain("data-side-chat-composer-footer-spacer");
    expect(source).toContain("env(safe-area-inset-bottom)+3rem");
    expect(source).toContain("env(safe-area-inset-bottom)+3.25rem");
  });

  it("prevents the shared composer form from navigating the page on send", () => {
    expect(source).toContain("event?.preventDefault()");
    expect(source).not.toContain("onSend={() => void handleSend()}");
  });

  it("focuses the side composer once its target thread is ready", () => {
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s+if \(!thread\?\.id\) return;\s+scheduleComposerFocus\(\);\s+\}, \[scheduleComposerFocus, thread\?\.id\]\);/,
    );
  });
});
