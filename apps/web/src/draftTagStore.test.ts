import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { DraftId } from "./composerDraftStore";
import { createMemoryStorage } from "./lib/storage";
import { makeThreadFixture } from "./test-fixtures";
import {
  collectActiveDraftTags,
  createDraftTagStore,
  readPersistedDraftTags,
} from "./draftTagStore";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const draftId = DraftId.make("draft-test");
const now = "2026-10-14T12:00:00.000Z";
const purpleTag = { label: "v3 refactor", color: "#a855f7" };

describe("active draft tag choices", () => {
  it("collects across projects and environments, deduplicating label and color together", () => {
    const threads = [
      makeThreadFixture({ id: ThreadId.make("one"), environmentId: local }),
      makeThreadFixture({ id: ThreadId.make("two"), environmentId: remote }),
      makeThreadFixture({ id: ThreadId.make("three"), environmentId: remote, pinnedAt: now }),
    ];
    expect(
      collectActiveDraftTags({
        threads,
        tagsByEnvironment: new Map([
          [local, { one: { label: "Refactor", color: "#ABCDEF" }, orphan: { label: "Deleted" } }],
          [
            remote,
            {
              two: { label: "Refactor", color: "#abcdef" },
              three: { label: "Refactor", color: "#ff0000" },
            },
          ],
        ]),
        postponedThreadKeys: new Set(),
        now,
      }),
    ).toEqual([
      { label: "Refactor", color: "#abcdef" },
      { label: "Refactor", color: "#ff0000" },
    ]);
  });

  it("excludes archived, deleted, settled, postponed and currently snoozed threads", () => {
    const threads = [
      makeThreadFixture({ id: ThreadId.make("archived"), environmentId: local, archivedAt: now }),
      makeThreadFixture({ id: ThreadId.make("deleted"), environmentId: local, deletedAt: now }),
      makeThreadFixture({
        id: ThreadId.make("settled"),
        environmentId: local,
        settledOverride: "settled",
      }),
      makeThreadFixture({ id: ThreadId.make("postponed"), environmentId: local }),
      makeThreadFixture({
        id: ThreadId.make("snoozed"),
        environmentId: local,
        snoozedUntil: "2026-10-15T12:00:00.000Z",
        snoozedAt: now,
      }),
      makeThreadFixture({
        id: ThreadId.make("awake"),
        environmentId: local,
        snoozedUntil: "2026-10-13T12:00:00.000Z",
        snoozedAt: "2026-10-12T12:00:00.000Z",
      }),
    ];
    const tags = Object.fromEntries(threads.map((thread) => [thread.id, { label: thread.id }]));
    expect(
      collectActiveDraftTags({
        threads,
        tagsByEnvironment: new Map([[local, tags]]),
        postponedThreadKeys: new Set([
          scopedThreadKey(scopeThreadRef(local, ThreadId.make("postponed"))),
        ]),
        now,
      }),
    ).toEqual([{ label: "awake", color: null }]);
  });
});

describe("fork-owned draft tag storage", () => {
  it("preserves the selected label and color across reload, and clearing affects only that draft", () => {
    const storage = createMemoryStorage();
    const first = createDraftTagStore(storage);
    const otherDraftId = DraftId.make("another");
    first.getState().select(draftId, purpleTag);
    first.getState().select(otherDraftId, { label: "Mobile", color: null });
    const reloaded = createDraftTagStore(storage);
    expect(reloaded.getState().byDraftId[draftId]).toEqual(purpleTag);
    reloaded.getState().select(draftId, null);
    expect(createDraftTagStore(storage).getState().byDraftId).toEqual({
      another: { label: "Mobile", color: null },
    });
  });

  it("retains a destination transfer after its draft is promoted or discarded", () => {
    const storage = createMemoryStorage();
    const store = createDraftTagStore(storage);
    const threadRef = scopeThreadRef(remote, ThreadId.make("created"));
    store.getState().select(draftId, purpleTag);
    store.getState().stage(threadRef, purpleTag);
    store.getState().prune(new Set());
    const reloaded = createDraftTagStore(storage);
    expect(reloaded.getState().byDraftId).toEqual({});
    expect(reloaded.getState().pendingByThreadKey[scopedThreadKey(threadRef)]).toEqual({
      threadRef,
      tag: purpleTag,
    });
  });

  it("does not let an old completion erase a newer staged tag", () => {
    const store = createDraftTagStore(createMemoryStorage());
    const threadRef = scopeThreadRef(remote, ThreadId.make("created"));
    store.getState().stage(threadRef, purpleTag);
    const first = store.getState().pendingByThreadKey[scopedThreadKey(threadRef)]!;
    store.getState().stage(threadRef, { label: "Newer", color: null });
    store.getState().complete(first);
    expect(store.getState().pendingByThreadKey[scopedThreadKey(threadRef)]?.tag.label).toBe(
      "Newer",
    );
    store.getState().complete(store.getState().pendingByThreadKey[scopedThreadKey(threadRef)]!);
    expect(store.getState().pendingByThreadKey).toEqual({});
  });

  it("ignores malformed stored tags without discarding valid draft selections", () => {
    expect(
      readPersistedDraftTags({
        byDraftId: { good: purpleTag, bad: { label: "", color: "purple" } },
        pendingByThreadKey: { broken: { tag: purpleTag } },
      }),
    ).toEqual({ byDraftId: { good: purpleTag }, pendingByThreadKey: {} });
  });
});
