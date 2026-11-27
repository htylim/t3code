import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { assert, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({}));

import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopIpc from "./DesktopIpc.ts";

it.effect("answers every registered app window's top frame", () =>
  Effect.gen(function* () {
    const mainFrame = {};
    const invoke = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
    const sync = new Map<string, DesktopIpc.DesktopIpcSyncListener>();
    const ipc = yield* DesktopIpc.DesktopIpc.pipe(
      Effect.provide(
        DesktopIpc.layer({
          removeHandler: (channel) => void invoke.delete(channel),
          handle: (channel, listener) => void invoke.set(channel, listener),
          removeAllListeners: (channel) => void sync.delete(channel),
          on: (channel, listener) => void sync.set(channel, listener),
        }).pipe(
          Layer.provide(
            Layer.mock(ElectronWindow.ElectronWindow, {
              fromWebContentsId: (id) =>
                Effect.succeed(
                  id === 1 || id === 3
                    ? Option.some({
                        webContents: { id, mainFrame },
                      } as unknown as Electron.BrowserWindow)
                    : Option.none(),
                ),
            }),
          ),
        ),
      ),
    );
    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: "token",
        payload: Schema.Void,
        result: Schema.String,
        handler: () => Effect.succeed("secret"),
      }),
    );
    yield* ipc.handleSync({
      channel: "token-sync",
      handler: (event) => Effect.succeed(event?.sender.id),
    });

    const senders = {
      app: { sender: { id: 1 }, senderFrame: mainFrame },
      secondApp: { sender: { id: 3 }, senderFrame: mainFrame },
      appSubframe: { sender: { id: 1 }, senderFrame: {} },
      previewGuest: { sender: { id: 2 }, senderFrame: {} },
    };
    const results: Record<string, unknown> = {};
    for (const [name, sender] of Object.entries(senders)) {
      const event = { ...sender, returnValue: "unset" as unknown };
      sync.get("token-sync")!(event);
      results[name] = [
        yield* Effect.promise(() =>
          Promise.resolve(invoke.get("token")!(sender, undefined)).catch(() => "rejected"),
        ),
        event.returnValue,
      ];
    }
    assert.deepEqual(results, {
      app: ["secret", 1],
      secondApp: ["secret", 3],
      appSubframe: ["rejected", undefined],
      previewGuest: ["rejected", undefined],
    });
  }),
);
