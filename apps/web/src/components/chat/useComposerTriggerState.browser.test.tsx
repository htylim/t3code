import { act, render as renderScreen } from "../../../test/render";
import { StrictMode, useLayoutEffect } from "react";
import { describe, expect, it } from "vite-plus/test";

import { detectComposerTrigger } from "../../composer-logic";
import { useComposerTriggerState } from "./useComposerTriggerState";

const command = "pnpm install -g @openai/codex@latest";
const initialPrompt = "pnpm install -g @openai";
/** Owns the hook state and rendered tree for one test. */
async function createTestSurface() {
  let composer: ReturnType<typeof useComposerTriggerState>;

  /** Reports each committed hook state without sharing it between tests. */
  function ComposerProbe() {
    const state = useComposerTriggerState(() =>
      detectComposerTrigger(initialPrompt, initialPrompt.length),
    );
    useLayoutEffect(() => {
      composer = state;
    });
    return null;
  }

  const screen = await renderScreen(
    <StrictMode>
      <ComposerProbe />
    </StrictMode>,
  );
  return {
    get composer() {
      return composer;
    },
    /** Updates the trigger through the same detection path as the editor. */
    async updatePrompt(text: string, cursor = text.length) {
      await act(() => composer.setTrigger(detectComposerTrigger(text, cursor)));
    },
    [Symbol.asyncDispose]: () => screen[Symbol.asyncDispose](),
  };
}

describe("composer suggestion dismissal", () => {
  it("closes suggestions and rejects keyboard selection before the next render", async () => {
    await using surface = await createTestSurface();

    const candidate = detectComposerTrigger(initialPrompt, initialPrompt.length);
    expect(surface.composer.trigger).toEqual(candidate);

    await act(() => {
      surface.composer.dismissTrigger(candidate);
      expect(surface.composer.resolveTrigger(candidate)).toBeNull();
    });
    expect(surface.composer.trigger).toBeNull();
  });

  it("stays dismissed while typing a scoped package, including its second @", async () => {
    await using surface = await createTestSurface();

    await act(() => surface.composer.dismissTrigger(surface.composer.trigger));

    for (let cursor = initialPrompt.length; cursor <= command.length; cursor += 1) {
      const text = command.slice(0, cursor);
      await surface.updatePrompt(text);
      expect(surface.composer.trigger).toBeNull();
      expect(surface.composer.resolveTrigger(detectComposerTrigger(text, cursor))).toBeNull();
    }
  });

  it("stays dismissed while deleting characters or moving within the same word", async () => {
    await using surface = await createTestSurface();

    await act(() => surface.composer.dismissTrigger(surface.composer.trigger));

    for (let cursor = initialPrompt.length - 1; cursor > initialPrompt.indexOf("@"); cursor -= 1) {
      await surface.updatePrompt(initialPrompt, cursor);
      expect(surface.composer.trigger).toBeNull();
      await surface.updatePrompt(initialPrompt.slice(0, cursor));
      expect(surface.composer.trigger).toBeNull();
    }
  });

  it("opens suggestions for a new @ word after a space", async () => {
    await using surface = await createTestSurface();

    await act(() => surface.composer.dismissTrigger(surface.composer.trigger));
    await surface.updatePrompt(`${command} `);
    await surface.updatePrompt(`${command} @src`);

    expect(surface.composer.trigger?.query).toBe("src");
    expect(surface.composer.trigger?.rangeStart).toBe(command.length + 1);
  });

  it("opens a different token when the caret moves directly to it", async () => {
    await using surface = await createTestSurface();

    await act(() => surface.composer.dismissTrigger(surface.composer.trigger));
    await surface.updatePrompt(`${command} @src`);

    expect(surface.composer.trigger?.query).toBe("src");
  });

  it("can reopen after the caret leaves the dismissed word", async () => {
    await using surface = await createTestSurface();

    await act(() => surface.composer.dismissTrigger(surface.composer.trigger));
    await surface.updatePrompt(initialPrompt, 0);
    await surface.updatePrompt(initialPrompt);

    expect(surface.composer.trigger?.query).toBe("openai");
  });

  it("can reopen at the same position after deleting and retyping @", async () => {
    await using surface = await createTestSurface();

    await act(() => surface.composer.dismissTrigger(surface.composer.trigger));
    const prefix = initialPrompt.slice(0, initialPrompt.indexOf("@"));
    await surface.updatePrompt(prefix);
    await surface.updatePrompt(`${prefix}@`);

    expect(surface.composer.trigger?.query).toBe("");
  });

  it("clears dismissal when switching drafts or pending questions", async () => {
    await using surface = await createTestSurface();

    await act(() => surface.composer.dismissTrigger(surface.composer.trigger));
    const candidate = detectComposerTrigger(initialPrompt, initialPrompt.length);
    await act(() => surface.composer.resetTrigger(candidate));

    expect(surface.composer.trigger).toEqual(candidate);
    expect(surface.composer.resolveTrigger(candidate)).toEqual(candidate);
  });

  it.each(["/plan", "$skill", "#123", "%login", "%%login"])(
    "also dismisses %s suggestions",
    async (text) => {
      await using surface = await createTestSurface();

      await surface.updatePrompt(text);
      await act(() => surface.composer.dismissTrigger(surface.composer.trigger));
      await surface.updatePrompt(`${text}x`);

      expect(surface.composer.trigger).toBeNull();
      await surface.updatePrompt("@src");
      expect(surface.composer.trigger?.kind).toBe("path");
    },
  );

  it("keeps escaped multiword thread searches dismissed until a fresh marker", async () => {
    await using surface = await createTestSurface();

    await surface.updatePrompt("%login");
    await act(() => surface.composer.dismissTrigger(surface.composer.trigger));
    await surface.updatePrompt("%login flow ");
    expect(surface.composer.trigger).toBeNull();
    await surface.updatePrompt("%login flow %%");
    expect(surface.composer.trigger?.threadScope).toBe("environment");
    expect(surface.composer.trigger?.query).toBe("");
  });
});
