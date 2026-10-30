import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  groupSidebarWorkspaceThreads,
  sidebarWorkspaceCardThreadKeys,
  sidebarWorkspaceRowPositions,
} from "./Sidebar.workspaceGrouping";

/** Build only the identity and workspace fields used by the presentation grouping. */
function thread(id: string, worktreePath: string | null = "/work/feature") {
  return {
    id: ThreadId.make(id),
    environmentId: EnvironmentId.make("local"),
    projectId: ProjectId.make("project"),
    worktreePath,
    branch: null as string | null,
  };
}

describe("sidebar workspace cards", () => {
  it("selects only current members of the clicked card in visible order", () => {
    const first = thread("first");
    const second = thread("second");
    const postponed = thread("postponed");
    const otherWorkspace = thread("other-workspace", null);
    const otherProject = { ...thread("other-project"), projectId: ProjectId.make("other") };
    const remote = { ...thread("remote"), environmentId: EnvironmentId.make("remote") };
    const threads = [first, postponed, otherWorkspace, second, otherProject, remote];
    const threadsByKey = new Map(threads.map((entry) => [entry.id, entry]));
    const sectionsByThreadKey = new Map<string, string>(
      threads.map((entry) => [entry.id, "active"]),
    );
    sectionsByThreadKey.set(postponed.id, "postponed");
    expect(
      sidebarWorkspaceCardThreadKeys({ threadKey: first.id, threadsByKey, sectionsByThreadKey }),
    ).toEqual([first.id, second.id]);
  });

  it("refreshes card membership after a thread moves to a different workspace", () => {
    const first = thread("first");
    const second = thread("second");
    const threadsByKey = new Map([
      [first.id, first],
      [second.id, second],
    ]);
    const sectionsByThreadKey = new Map([
      [first.id, "active"],
      [second.id, "active"],
    ]);
    const card = { threadKey: first.id, threadsByKey, sectionsByThreadKey };
    expect(sidebarWorkspaceCardThreadKeys(card)).toEqual([first.id, second.id]);
    threadsByKey.set(second.id, { ...second, worktreePath: "/work/moved" });
    expect(sidebarWorkspaceCardThreadKeys(card)).toEqual([first.id]);
  });

  it("ignores missing and settled cards", () => {
    const first = thread("first");
    const threadsByKey = new Map([[first.id, first]]);
    expect(
      sidebarWorkspaceCardThreadKeys({
        threadKey: "missing",
        threadsByKey,
        sectionsByThreadKey: new Map(),
      }),
    ).toEqual([]);
    expect(
      sidebarWorkspaceCardThreadKeys({
        threadKey: first.id,
        threadsByKey,
        sectionsByThreadKey: new Map(),
      }),
    ).toEqual([]);
    expect(
      sidebarWorkspaceCardThreadKeys({
        threadKey: first.id,
        threadsByKey,
        sectionsByThreadKey: new Map([[first.id, "settled"]]),
      }),
    ).toEqual([]);
  });

  it("collects non-adjacent matches at the first member without sorting their titles or activity", () => {
    const first = thread("first");
    const other = thread("other", "/work/other");
    const second = thread("second");
    const main = thread("main", null);
    const secondMain = thread("second-main", null);
    expect(groupSidebarWorkspaceThreads([first, other, second, main, secondMain], true)).toEqual([
      [first, second],
      [other],
      [main, secondMain],
    ]);
  });

  it("separates a thread immediately when its workspace changes and rejoins it when restored", () => {
    const first = thread("first");
    const second = thread("second");
    expect(groupSidebarWorkspaceThreads([first, second], true)).toEqual([[first, second]]);
    const moved = { ...second, worktreePath: "/work/moved" };
    expect(groupSidebarWorkspaceThreads([first, moved], true)).toEqual([[first], [moved]]);
    expect(groupSidebarWorkspaceThreads([first, second], true)).toEqual([[first, second]]);
  });

  it("never combines different physical projects, environments, or scratch directories", () => {
    const first = thread("first");
    const otherProject = { ...thread("other-project"), projectId: ProjectId.make("other") };
    const remote = { ...thread("remote"), environmentId: EnvironmentId.make("remote") };
    const scratch = {
      ...thread("scratch", "/scratch/first"),
      projectId: ProjectId.make("scratch"),
    };
    const secondScratch = {
      ...thread("second-scratch", "/scratch/second"),
      projectId: ProjectId.make("scratch"),
    };
    const threads = [first, otherProject, remote, scratch, secondScratch];
    expect(groupSidebarWorkspaceThreads(threads, true)).toEqual(threads.map((entry) => [entry]));
  });

  it("restores the original interleaved order when disabled without mutating thread data", () => {
    const threads = Object.freeze([
      Object.freeze(thread("first")),
      Object.freeze(thread("other", null)),
      Object.freeze(thread("second")),
    ]);
    expect(
      groupSidebarWorkspaceThreads(threads, true)
        .flat()
        .map((entry) => entry.id),
    ).toEqual(["first", "second", "other"]);
    expect(groupSidebarWorkspaceThreads(threads, false).flat()).toEqual(threads);
    expect(sidebarWorkspaceRowPositions([threads], false).size).toBe(0);
  });

  it("frames matching rows independently inside each section and keeps singleton cards intact", () => {
    const active = [thread("first"), thread("second"), thread("third")];
    const postponed = [thread("postponed-first"), thread("postponed-second")];
    const snoozedSingleton = [thread("snoozed")];
    expect(
      Object.fromEntries(sidebarWorkspaceRowPositions([active, postponed, snoozedSingleton], true)),
    ).toMatchObject({
      "local:first": { position: "first", count: 3 },
      "local:second": { position: "middle", count: 3 },
      "local:third": { position: "last", count: 3 },
      "local:postponed-first": { position: "first", count: 2 },
      "local:postponed-second": { position: "last", count: 2 },
    });
    const positions = sidebarWorkspaceRowPositions([active, postponed], true);
    expect(positions.get("local:first")?.threadKeys).toEqual([
      "local:first",
      "local:second",
      "local:third",
    ]);
    expect(positions.get("local:postponed-first")?.threadKeys).toEqual([
      "local:postponed-first",
      "local:postponed-second",
    ]);
  });

  it("shows an ordinary row when a collapsed shelf exposes just its open thread", () => {
    expect(sidebarWorkspaceRowPositions([[thread("open")]], true).size).toBe(0);
    expect(sidebarWorkspaceRowPositions([[]], true).size).toBe(0);
  });

  it("uses workspace identity even when thread labels and saved branches disagree", () => {
    const first = { ...thread("first"), branch: "stale", title: "One", tag: "review" };
    const second = { ...thread("second"), branch: "current", title: "Two", tag: "other" };
    expect(groupSidebarWorkspaceThreads([first, second], true)).toEqual([[first, second]]);
  });

  it("keeps a saved workspace branch when the last thread has no branch", () => {
    const first = { ...thread("first", null), branch: "main" };
    const last = thread("last", null);
    const positions = sidebarWorkspaceRowPositions([[first, last]], true);
    expect(positions.get("local:last")).toMatchObject({ position: "last", branch: "main" });
    const reordered = sidebarWorkspaceRowPositions([[last, first]], true);
    expect(reordered.get("local:first")).toMatchObject({ position: "last", branch: "main" });
  });

  it("does not borrow a branch from another workspace or section", () => {
    const first = { ...thread("first"), branch: "feature" };
    const localThreads = [thread("local-first", null), thread("local-last", null)];
    const otherSection = { ...thread("other-section", null), branch: "main" };
    const positions = sidebarWorkspaceRowPositions(
      [[first, ...localThreads], [otherSection]],
      true,
    );
    expect(positions.get("local:local-last")).toMatchObject({ branch: null });
  });
});
