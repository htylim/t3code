import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, expectTypeOf, it } from "vite-plus/test";
import { makeThreadFixture } from "../test-fixtures";
import {
  formatSidebarRecency,
  presentSidebarThreadSection,
  type SidebarThreadOrder,
  type SidebarRecency,
} from "./Sidebar.presentation";

/** Keep send, reactivation, completion, settlement, and wake clocks deliberately different. */
function conversation(id: string) {
  return makeThreadFixture({
    id: ThreadId.make(id),
    createdAt: "2026-11-06T01:00:00.000Z",
    latestUserMessageAt: "2026-11-06T10:19:00.000Z",
    latestUserAuthoredMessageAt: "2026-11-06T09:00:00.000Z",
    unsettledAt: "2026-11-06T10:10:00.000Z",
    settledAt: "2026-11-06T10:15:00.000Z",
    snoozedUntil: "2026-11-06T10:40:00.000Z",
    latestRun: {
      runId: RunId.make(`run-${id}`),
      status: "completed",
      requestedAt: "2026-11-06T10:00:00.000Z",
      startedAt: "2026-11-06T10:00:00.000Z",
      completedAt: "2026-11-06T10:18:00.000Z",
      assistantMessageId: null,
    },
  });
}

describe("sidebar thread presentation", () => {
  it.each([
    { kind: "inbox", returnedAt: () => undefined, expected: "2m" },
    { kind: "sent", expected: "1h" },
    { kind: "active", expected: "10m" },
    { kind: "pinned", expected: "9h" },
    { kind: "settled", expected: "5m" },
    { kind: "snoozed", expected: "in 20m" },
  ] satisfies ReadonlyArray<SidebarThreadOrder & { readonly expected: string }>)(
    "$kind displays its ordering clock despite newer user-role messages",
    (scenario) => {
      const [presentation] = presentSidebarThreadSection([conversation("clocks")], scenario);
      expect(
        formatSidebarRecency(presentation!.recency, Date.parse("2026-11-06T10:20:00.000Z")),
      ).toBe(scenario.expected);
      expectTypeOf<EnvironmentThreadShell>().not.toMatchTypeOf<SidebarRecency>();
    },
  );

  it("uses the same observed return snapshot for placement and age without rewriting older records", () => {
    const first = conversation("first");
    const second = conversation("second");
    const firstReturn = Date.parse("2026-11-06T10:19:00.000Z");
    const secondReturn = Date.parse("2026-11-06T10:19:30.000Z");
    const initial = presentSidebarThreadSection([second, first], {
      kind: "inbox",
      returnedAt: (thread) => (thread === first ? firstReturn : undefined),
    });
    const updated = presentSidebarThreadSection([second, first], {
      kind: "inbox",
      returnedAt: (thread) => (thread === second ? secondReturn : firstReturn),
    });
    const now = Date.parse("2026-11-06T10:20:00.000Z");
    expect(initial.map((presentation) => presentation.thread.id)).toEqual([first.id, second.id]);
    expect(initial.map((presentation) => formatSidebarRecency(presentation.recency, now))).toEqual([
      "1m",
      "2m",
    ]);
    expect(updated.map((presentation) => presentation.thread.id)).toEqual([second.id, first.id]);
    expect(updated.map((presentation) => formatSidebarRecency(presentation.recency, now))).toEqual([
      "now",
      "1m",
    ]);
    expect(updated[1]).toBe(initial[0]);
    expect(updated[0]).not.toBe(initial[1]);
  });

  it("keeps explicit manual positions while unplaced active rows use their displayed clock", () => {
    const older = { ...conversation("older"), unsettledAt: "2026-11-06T10:01:00.000Z" };
    const newer = conversation("newer");
    const placed = { ...conversation("placed"), activeOrderKey: "b" };
    const nextPlaced = { ...conversation("next-placed"), activeOrderKey: "c" };
    const active = presentSidebarThreadSection([nextPlaced, older, placed, newer], {
      kind: "active",
    });
    expect(active.map((presentation) => presentation.thread.id)).toEqual([
      newer.id,
      older.id,
      placed.id,
      nextPlaced.id,
    ]);
    const pinned = presentSidebarThreadSection(
      [
        { ...newer, pinOrderKey: "c" },
        { ...older, pinOrderKey: "b" },
      ],
      { kind: "pinned" },
    );
    expect(pinned.map((presentation) => presentation.thread.id)).toEqual([older.id, newer.id]);
  });

  it("orders snoozed rows by the wake time it displays and omits malformed clocks", () => {
    const later = conversation("later");
    const sooner = { ...conversation("sooner"), snoozedUntil: "2026-11-06T10:30:00.000Z" };
    const invalid = { ...conversation("invalid"), snoozedUntil: "invalid" };
    const rows = presentSidebarThreadSection([later, sooner, invalid], { kind: "snoozed" });
    expect(rows.map((presentation) => presentation.thread.id)).toEqual([
      invalid.id,
      sooner.id,
      later.id,
    ]);
    expect(
      rows.map((presentation) =>
        formatSidebarRecency(presentation.recency, Date.parse("2026-11-06T10:20:00.000Z")),
      ),
    ).toEqual([null, "in 10m", "in 20m"]);
  });
});
