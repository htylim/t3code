import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { createMemoryStorage } from "./lib/storage";
import {
  createPostponedThreadStore,
  isThreadSettledForActions,
  readPersistedPostponedThreads,
  resumedPostponedThreadKeys,
} from "./postponedThreadStore";
import { makeThreadFixture } from "./test-fixtures";

const firstThread = makeThreadFixture({
  id: ThreadId.make("first"),
  latestUserMessageAt: "2026-10-01T10:00:00Z",
});
const secondThread = makeThreadFixture({ id: ThreadId.make("second"), latestUserMessageAt: null });
const firstThreadKey = scopedThreadKey(scopeThreadRef(firstThread.environmentId, firstThread.id));
const secondThreadKey = scopedThreadKey(
  scopeThreadRef(secondThread.environmentId, secondThread.id),
);

describe("fork postponed thread preferences", () => {
  it("keeps Settle available on postponed work that automatically settled", () => {
    expect(isThreadSettledForActions("settled", true)).toBe(false);
    expect(isThreadSettledForActions("settled", false)).toBe(true);
    expect(isThreadSettledForActions(null, true)).toBe(false);
    expect(isThreadSettledForActions(null, false)).toBe(false);
  });

  it("persists an Undo snapshot without overwriting a newer postponement", () => {
    const storage = createMemoryStorage();
    const store = createPostponedThreadStore(storage);
    const originalRecord = { latestUserMessageAt: "2026-10-01T10:00:00Z" };
    store.getState().reinstate(firstThreadKey, originalRecord);
    expect(createPostponedThreadStore(storage).getState().byThreadKey[firstThreadKey]).toEqual(
      originalRecord,
    );
    const newerRecord = { latestUserMessageAt: "2026-10-02T10:00:00Z" };
    store.getState().restore([firstThreadKey]);
    store.getState().reinstate(firstThreadKey, newerRecord);
    store.getState().reinstate(firstThreadKey, originalRecord);
    expect(store.getState().byThreadKey[firstThreadKey]).toEqual(newerRecord);
  });

  it("keeps a bulk postponement and the collapsed section after a restart", () => {
    const storage = createMemoryStorage();
    const firstSession = createPostponedThreadStore(storage);
    firstSession.getState().postpone([firstThread, secondThread]);
    firstSession.getState().toggleShelf();
    firstSession.getState().toggleShelf();

    const nextSession = createPostponedThreadStore(storage);
    expect(nextSession.getState().shelfExpanded).toBe(false);
    expect(Object.keys(nextSession.getState().byThreadKey)).toEqual([
      firstThreadKey,
      secondThreadKey,
    ]);
    nextSession.getState().toggleShelf();
    expect(createPostponedThreadStore(storage).getState().shelfExpanded).toBe(true);
  });

  it("restores only the chosen threads and retains the section preference", () => {
    const storage = createMemoryStorage();
    const store = createPostponedThreadStore(storage);
    store.getState().postpone([firstThread, secondThread]);
    store.getState().toggleShelf();
    store.getState().restore([firstThreadKey]);

    const nextSession = createPostponedThreadStore(storage);
    expect(Object.keys(nextSession.getState().byThreadKey)).toEqual([secondThreadKey]);
    expect(nextSession.getState().shelfExpanded).toBe(true);
  });

  it("isolates identical thread ids in different environments", () => {
    const store = createPostponedThreadStore(createMemoryStorage());
    const remoteThread = { ...firstThread, environmentId: EnvironmentId.make("remote") };
    const remoteThreadKey = scopedThreadKey(
      scopeThreadRef(remoteThread.environmentId, remoteThread.id),
    );
    store.getState().postpone([firstThread, remoteThread]);
    store.getState().restore([firstThreadKey]);
    expect(Object.keys(store.getState().byThreadKey)).toEqual([remoteThreadKey]);
  });

  it("stays postponed after completion, failure, approval or automatic settlement", () => {
    const store = createPostponedThreadStore(createMemoryStorage());
    store.getState().postpone([firstThread]);
    for (const thread of [
      { ...firstThread, updatedAt: "2026-10-02T10:00:00Z" },
      { ...firstThread, hasPendingApprovals: true },
      { ...firstThread, hasPendingUserInput: true },
      { ...firstThread, settledOverride: "settled" as const },
      ...(["failed", "completed"] as const).map((status) =>
        makeThreadFixture({
          ...firstThread,
          runtime: {
            status,
            activeRunId: null,
            providerInstanceId: ProviderInstanceId.make("codex"),
            providerName: "Codex",
            lastError: null,
            updatedAt: "2026-10-02T10:00:00Z",
          },
        }),
      ),
    ]) {
      expect(resumedPostponedThreadKeys([thread], store.getState().byThreadKey)).toEqual([]);
    }
  });

  it("restores on a new user send, including a first message, without touching other environments", () => {
    const store = createPostponedThreadStore(createMemoryStorage());
    store.getState().postpone([firstThread, secondThread]);
    const sentAt = "2026-10-03T10:00:00Z";
    expect(
      resumedPostponedThreadKeys(
        [
          { ...firstThread, latestUserMessageAt: sentAt },
          { ...secondThread, latestUserMessageAt: sentAt },
          {
            ...firstThread,
            environmentId: EnvironmentId.make("remote"),
            latestUserMessageAt: sentAt,
          },
        ],
        store.getState().byThreadKey,
      ),
    ).toEqual([firstThreadKey, secondThreadKey]);
    expect(resumedPostponedThreadKeys([], store.getState().byThreadKey)).toEqual([]);
  });

  it("does not restore from older cached messages or a repeated postpone", () => {
    const store = createPostponedThreadStore(createMemoryStorage());
    store.getState().postpone([firstThread]);
    const newer = { ...firstThread, latestUserMessageAt: "2026-10-04T10:00:00Z" };
    store.getState().postpone([newer]);
    expect(resumedPostponedThreadKeys([newer], store.getState().byThreadKey)).toEqual([
      firstThreadKey,
    ]);
    expect(
      resumedPostponedThreadKeys(
        [{ ...firstThread, latestUserMessageAt: "2026-09-01T10:00:00Z" }],
        store.getState().byThreadKey,
      ),
    ).toEqual([]);
  });

  it("drops malformed preferences without hiding a thread", () => {
    expect(
      readPersistedPostponedThreads({
        shelfExpanded: "false",
        byThreadKey: {
          [firstThreadKey]: { latestUserMessageAt: firstThread.latestUserMessageAt },
          unscoped: { latestUserMessageAt: null },
          "remote:invalid-date": { latestUserMessageAt: "bad date" },
          "remote:invalid-record": true,
        },
      }),
    ).toEqual({
      byThreadKey: { [firstThreadKey]: { latestUserMessageAt: firstThread.latestUserMessageAt } },
      shelfExpanded: false,
    });
  });
});
