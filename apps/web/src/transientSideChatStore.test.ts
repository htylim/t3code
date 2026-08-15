import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  deleteTransientSideChat,
  isTransientSideChat,
  migratePersistedTransientSideChats,
  registerTransientSideChat,
  selectStartupTransientSideChats,
  useTransientSideChatStore,
} from "./transientSideChatStore";

const ref = scopeThreadRef(EnvironmentId.make("environment-a"), ThreadId.make("transient-thread"));

describe("transient side chat registry", () => {
  beforeEach(() => {
    useTransientSideChatStore.setState({ byThreadKey: {} });
  });

  it("keeps only valid scoped thread references during hydration", () => {
    expect(
      migratePersistedTransientSideChats({
        byThreadKey: {
          "environment-a:transient-thread": ref,
          "environment-a:wrong-key": ref,
          malformed: { environmentId: 42, threadId: null },
        },
      }),
    ).toEqual({
      byThreadKey: { "environment-a:transient-thread": ref },
    });
  });

  it("removes an id only after deletion succeeds", async () => {
    registerTransientSideChat(ref);
    const failure = vi.fn().mockResolvedValue({ _tag: "Failure" as const });

    await deleteTransientSideChat(ref, failure);
    expect(isTransientSideChat(ref)).toBe(true);

    const success = vi.fn().mockResolvedValue({ _tag: "Success" as const });
    await deleteTransientSideChat(ref, success);
    expect(isTransientSideChat(ref)).toBe(false);
    expect(success).toHaveBeenCalledWith({
      environmentId: ref.environmentId,
      input: { threadId: ref.threadId },
    });
  });

  it("cleans only ids captured when the app started", () => {
    const later = scopeThreadRef(
      EnvironmentId.make("environment-a"),
      ThreadId.make("created-this-session"),
    );
    const pendingByThreadKey = {
      "environment-a:transient-thread": ref,
      "environment-a:created-this-session": later,
    };

    expect(
      selectStartupTransientSideChats({
        startupThreadKeys: new Set(["environment-a:transient-thread"]),
        pendingByThreadKey,
        connectedEnvironmentIds: new Set([ref.environmentId]),
        inFlightThreadKeys: new Set(),
      }),
    ).toEqual([ref]);
  });
});
