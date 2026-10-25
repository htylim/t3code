import type {
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { describe, expect, it, vi } from "vite-plus/test";

import { makeThreadFixture } from "../test-fixtures";
import {
  forgetTransientSideChat,
  registerTransientSideChat,
  useTransientSideChatStore,
} from "../transientSideChatStore";
import { selectThreadRelationshipShells, useQuietThreadShells } from "./entities";

vi.mock("@effect/atom-react", () => ({ useAtomValue: vi.fn() }));
vi.mock("../transientSideChatStore", async (importOriginal) => {
  const transientChats = await importOriginal<typeof import("../transientSideChatStore")>();
  type TransientChatState = ReturnType<typeof transientChats.useTransientSideChatStore.getState>;
  return {
    ...transientChats,
    useTransientSideChatStore: Object.assign(
      (selector: (state: TransientChatState) => unknown) =>
        selector(transientChats.useTransientSideChatStore.getState()),
      transientChats.useTransientSideChatStore,
    ),
  };
});

type Projection = Parameters<typeof selectThreadRelationshipShells>[1];

const shell = (id: string, parentThreadId: string | null = null) =>
  ({
    id,
    forkedFrom: null,
    lineage: { parentThreadId, relationshipToParent: parentThreadId === null ? null : "fork" },
  }) as unknown as OrchestrationV2ThreadShell;

const threadId = "current" as OrchestrationV2ThreadShell["id"];

describe("useQuietThreadShells", () => {
  it("hides transient chats by environment and follows changes to their registration", () => {
    const environmentId = EnvironmentId.make("local");
    const transientThreadId = ThreadId.make("side-chat");
    const transientRef = { environmentId, threadId: transientThreadId };
    const owner = makeThreadFixture({ environmentId, id: ThreadId.make("owner") });
    const transient = makeThreadFixture({ environmentId, id: transientThreadId });
    const remote = makeThreadFixture({
      environmentId: EnvironmentId.make("remote"),
      id: transientThreadId,
    });
    const quietThreads = [owner, transient, remote];
    vi.mocked(useAtomValue).mockReturnValue(quietThreads);
    useTransientSideChatStore.setState({ byThreadKey: {} });

    try {
      expect(useQuietThreadShells()).toEqual(quietThreads);

      registerTransientSideChat(transientRef);
      expect(useQuietThreadShells()).toEqual([owner, remote]);

      forgetTransientSideChat(transientRef);
      expect(useQuietThreadShells()).toEqual(quietThreads);
    } finally {
      useTransientSideChatStore.setState({ byThreadKey: {} });
      vi.mocked(useAtomValue).mockReset();
    }
  });
});

describe("selectThreadRelationshipShells", () => {
  it("keeps the thread, its parent, its children and the threads its projection names", () => {
    const threads = [
      shell("current", "parent"),
      shell("parent"),
      shell("child", "current"),
      shell("subagent-child"),
      shell("workflow-member"),
      shell("transfer-source"),
      shell("unrelated"),
      shell("grandchild", "child"),
    ];
    const projection = {
      thread: threads[0],
      subagents: [
        {
          childThreadId: "subagent-child",
          workflow: { agents: [{ childThreadId: "workflow-member" }, {}] },
        },
        { childThreadId: null },
      ],
      contextTransfers: [{ sourceThreadId: "transfer-source", targetThreadId: "current" }],
    } as unknown as Pick<
      OrchestrationV2ThreadProjection,
      "thread" | "subagents" | "contextTransfers"
    >;

    expect(
      selectThreadRelationshipShells(threadId, projection, threads).map((thread) => thread.id),
    ).toEqual([
      "current",
      "parent",
      "child",
      "subagent-child",
      "workflow-member",
      "transfer-source",
    ]);
  });

  it("finds the parent from the shell before the projection loads", () => {
    const threads = [shell("current", "parent"), shell("parent"), shell("unrelated")];
    expect(
      selectThreadRelationshipShells(threadId, null as Projection, threads).map(
        (thread) => thread.id,
      ),
    ).toEqual(["current", "parent"]);
  });
});
