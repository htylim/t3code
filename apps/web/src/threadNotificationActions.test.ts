import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

const notificationMocks = vi.hoisted(() => ({
  mode: "off",
  prepare: vi.fn<() => Promise<string | null>>(),
  toast: vi.fn(),
}));
vi.mock("./hooks/useSettings", () => ({
  getClientSettings: () => ({ notificationMode: notificationMocks.mode }),
}));
vi.mock("./threadNotifications", () => ({ prepareThreadNotifications: notificationMocks.prepare }));
vi.mock("./components/ui/toast", () => ({ toastManager: { add: notificationMocks.toast } }));

import { toggleThreadNotifications } from "./threadNotificationActions";
import { useThreadNotificationStore } from "./threadNotificationStore";

/** Reset local choices and permission responses for each toggle flow. */
function setup() {
  notificationMocks.mode = "off";
  notificationMocks.prepare.mockReset().mockResolvedValue(null);
  notificationMocks.toast.mockReset();
  useThreadNotificationStore.setState({ enabledThreadKeys: {} });
  return scopeThreadRef(EnvironmentId.make("one"), ThreadId.make("thread"));
}

it("requires permission to enable, but can disable after permission is revoked", async () => {
  const threadRef = setup();
  await toggleThreadNotifications(threadRef);
  expect(useThreadNotificationStore.getState().enabledThreadKeys).toEqual({
    [scopedThreadKey(threadRef)]: true,
  });
  notificationMocks.prepare.mockResolvedValue("Permission denied");
  await toggleThreadNotifications(threadRef);
  expect(useThreadNotificationStore.getState().enabledThreadKeys).toEqual({});
  await toggleThreadNotifications(threadRef);
  expect(useThreadNotificationStore.getState().enabledThreadKeys).toEqual({});
  expect(notificationMocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "error",
      description: "Permission denied",
    }),
  );
});

it("does not save an opt-in if global notifications change while permission is pending", async () => {
  const threadRef = setup();
  let allowNotifications!: (permissionError: string | null) => void;
  const permission = new Promise<string | null>((resolve) => {
    allowNotifications = resolve;
  });
  notificationMocks.prepare.mockReturnValue(permission);
  const toggling = toggleThreadNotifications(threadRef);
  notificationMocks.mode = "sound";
  allowNotifications(null);
  await toggling;
  expect(useThreadNotificationStore.getState().enabledThreadKeys).toEqual({});
  await toggleThreadNotifications(threadRef);
  expect(useThreadNotificationStore.getState().enabledThreadKeys).toEqual({});
});
