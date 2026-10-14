import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  OrchestrationDispatchCommandError,
  MessageId,
  ThreadId,
  type ThreadTags,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { DraftId } from "../composerDraftStore";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import { makeThreadFixture } from "../test-fixtures";

const state = vi.hoisted(() => ({
  supported: true,
  allowed: true,
  snapshot: {} as ThreadTags | null,
  threadExists: false,
  phase: "connected",
  start: vi.fn(),
  save: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("../composerDraftStore", () => ({
  useComposerDraftStore: Object.assign(
    (select: (store: unknown) => unknown) =>
      select({ draftThreadsByThreadKey: { "draft-flow": {} } }),
    { getState: () => ({ getDraftIdByRef: () => "draft-flow" as DraftId }) },
  ),
}));
vi.mock("../state/threadTags", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    readThreadTagsSupported: () => state.supported,
    threadTagEnvironment: {
      supportedAtom: () => Atom.make(state.supported),
      snapshotAtom: () => Atom.make(state.snapshot),
      set: { permissionAtom: () => Atom.make(state.allowed) },
    },
  };
});
vi.mock("../state/use-orchestration-command", () => ({
  useOrchestrationCommand: () => state.start,
}));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => state.save }));
vi.mock("../state/entities", () => ({
  useThreadShell: () => (state.threadExists ? makeThreadFixture() : null),
}));
vi.mock("../state/environments", () => ({
  useEnvironments: () => ({
    presentationById: new Map([["remote", { connection: { phase: state.phase } }]]),
  }),
}));
vi.mock("../components/ui/toast", () => ({
  stackedThreadToast: (toast: unknown) => toast,
  toastManager: { add: state.toast },
}));

import { DraftTagTransfers } from "../components/DraftTagTransfers";
import { useDraftTagStartTurn } from "./useDraftTagStartTurn";
import { useDraftTagStore } from "../draftTagStore";

const draftId = "draft-flow" as DraftId;
const remote = EnvironmentId.make("remote");
const tag = { label: "v3 refactor", color: "#8b5cf6" };
const destination = scopeThreadRef(remote, ThreadId.make("new-thread"));
let renderer: ReactTestRenderer;
let start: ReturnType<typeof useDraftTagStartTurn>;

/** Exercise the actual send hook together with the transfer host. */
function Harness() {
  const startCommand = useDraftTagStartTurn(draftId);
  useEffect(() => {
    start = startCommand;
  }, [startCommand]);
  return <DraftTagTransfers />;
}

/** Build an ordinary draft bootstrap request, with an independently selected destination. */
function request(threadId = destination.threadId): Parameters<typeof start>[0] {
  const thread = makeThreadFixture();
  return {
    environmentId: remote,
    input: {
      threadId,
      message: {
        messageId: MessageId.make("message"),
        role: "user",
        text: "test",
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      bootstrap: {
        createThread: {
          projectId: thread.projectId,
          title: "Test",
          modelSelection: thread.modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: thread.createdAt,
        },
      },
    },
  };
}

/** Remount the host inputs without time-based polling. */
async function renderHarness(): Promise<void> {
  await act(async () => {
    if (renderer)
      renderer.update(
        <AppAtomRegistryProvider>
          <Harness />
        </AppAtomRegistryProvider>,
      );
    else
      renderer = create(
        <AppAtomRegistryProvider>
          <Harness />
        </AppAtomRegistryProvider>,
      );
  });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.supported = true;
  state.allowed = true;
  state.snapshot = {};
  state.threadExists = false;
  state.phase = "connected";
  state.start.mockReset().mockResolvedValue(AsyncResult.success({}));
  state.save.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.toast.mockReset();
  useDraftTagStore.setState({ byDraftId: {}, pendingByThreadKey: {} });
  useDraftTagStore.getState().select(draftId, tag);
  await renderHarness();
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  renderer = undefined!;
  vi.unstubAllGlobals();
});

it("stages the selected tag before dispatch and transfers to the actual environment once the thread appears", async () => {
  state.start.mockImplementation(async () => {
    expect(
      useDraftTagStore.getState().pendingByThreadKey[scopedThreadKey(destination)]?.tag,
    ).toEqual(tag);
    return AsyncResult.success({});
  });
  await act(async () => {
    await start(request());
  });
  expect(state.save).not.toHaveBeenCalled();
  state.threadExists = true;
  await renderHarness();
  expect(state.save).toHaveBeenCalledWith({
    environmentId: remote,
    input: { threadId: destination.threadId, tag },
  });
  expect(useDraftTagStore.getState().pendingByThreadKey).toEqual({});
});

it("tags every thread in a multi-model send without changing the draft selection", async () => {
  await act(async () => {
    await Promise.all([
      start(request(ThreadId.make("first-model"))),
      start(request(ThreadId.make("second-model"))),
    ]);
  });
  expect(
    Object.values(useDraftTagStore.getState().pendingByThreadKey).map((pending) => pending.tag),
  ).toEqual([tag, tag]);
  expect(useDraftTagStore.getState().byDraftId[draftId]).toEqual(tag);
});

it.each(["unsupported", "read-only"])(
  "refuses a tagged send to a %s destination before creating a thread",
  async (connection) => {
    state.supported = connection !== "unsupported";
    state.allowed = connection !== "read-only";
    const started = await start(request());
    expect(started._tag).toBe("Failure");
    expect(state.start).not.toHaveBeenCalled();
    expect(useDraftTagStore.getState().pendingByThreadKey).toEqual({});
  },
);

it("leaves ordinary turns and cleared drafts on the original send path", async () => {
  const followUp = request();
  const { bootstrap: _bootstrap, ...input } = followUp.input;
  await start({ ...followUp, input });
  useDraftTagStore.getState().select(draftId, null);
  await start(request());
  expect(state.start).toHaveBeenCalledTimes(2);
  expect(useDraftTagStore.getState().pendingByThreadKey).toEqual({});
});

it("drops confirmed never-created threads, but retains an uncertain disconnected launch", async () => {
  state.start.mockResolvedValueOnce(
    AsyncResult.failure(
      Cause.fail(
        new OrchestrationDispatchCommandError({
          message: "No base commit",
          bootstrapThreadDisposition: "not-created",
        }),
      ),
    ),
  );
  await act(async () => {
    await start(request());
  });
  expect(useDraftTagStore.getState().pendingByThreadKey).toEqual({});
  state.start.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Connection lost"))));
  await act(async () => {
    await start(request());
  });
  expect(useDraftTagStore.getState().pendingByThreadKey[scopedThreadKey(destination)]?.tag).toEqual(
    tag,
  );
});

it("keeps a failed tag write for explicit retry without sending the prompt again", async () => {
  state.threadExists = true;
  state.save.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Temporary failure"))));
  await act(async () => {
    await start(request());
  });
  expect(useDraftTagStore.getState().pendingByThreadKey[scopedThreadKey(destination)]?.tag).toEqual(
    tag,
  );
  const toast = state.toast.mock.calls[0]![0];
  await act(async () => toast.actionProps.onClick());
  expect(state.save).toHaveBeenCalledTimes(2);
  expect(state.start).toHaveBeenCalledTimes(1);
  expect(useDraftTagStore.getState().pendingByThreadKey).toEqual({});
});

it("waits for the tag snapshot and preserves an existing edit from another device", async () => {
  state.threadExists = true;
  state.snapshot = null;
  await act(async () => {
    await start(request());
  });
  expect(state.save).not.toHaveBeenCalled();
  state.snapshot = { [destination.threadId]: { label: "Edited elsewhere", color: null } };
  await renderHarness();
  expect(state.save).not.toHaveBeenCalled();
  expect(useDraftTagStore.getState().pendingByThreadKey).toEqual({});
});

it("retries an unfinished transfer after reconnecting", async () => {
  state.threadExists = true;
  state.save.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Connection lost"))));
  await act(async () => {
    await start(request());
  });
  state.phase = "disconnected";
  await renderHarness();
  state.phase = "connected";
  await renderHarness();
  expect(state.save).toHaveBeenCalledTimes(2);
  expect(useDraftTagStore.getState().pendingByThreadKey).toEqual({});
});

it("retries when a reconnect finishes before the previous tag request fails", async () => {
  state.threadExists = true;
  const failure = AsyncResult.failure(Cause.fail(new Error("Old connection lost")));
  let failPreviousRequest!: (settledFailure: typeof failure) => void;
  const previousRequest = new Promise<typeof failure>((resolve) => {
    failPreviousRequest = resolve;
  });
  state.save.mockReturnValueOnce(previousRequest);
  await act(async () => {
    await start(request());
  });
  state.phase = "disconnected";
  await renderHarness();
  state.phase = "connected";
  await renderHarness();
  expect(state.save).toHaveBeenCalledTimes(1);
  await act(async () => failPreviousRequest(failure));
  expect(state.save).toHaveBeenCalledTimes(2);
  expect(state.start).toHaveBeenCalledTimes(1);
  expect(useDraftTagStore.getState().pendingByThreadKey).toEqual({});
});
