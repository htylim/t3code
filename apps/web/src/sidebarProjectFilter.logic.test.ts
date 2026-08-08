import { describe, expect, it } from "vite-plus/test";

import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  resolveSidebarNewChatAction,
  resolveSidebarProjectFilterLabel,
} from "./sidebarProjectFilter.logic";
import type { SidebarProjectSnapshot } from "./sidebarProjectGrouping";

describe("resolveSidebarProjectFilterLabel", () => {
  const groups = [
    { projectKey: "project-one", displayName: "Project One" },
  ] as SidebarProjectSnapshot[];

  it("resolves the selected scope and falls back to All projects", () => {
    expect(resolveSidebarProjectFilterLabel(groups, "project-one")).toBe("Project One");
    expect(resolveSidebarProjectFilterLabel(groups, null)).toBe("All projects");
    expect(resolveSidebarProjectFilterLabel(groups, "missing")).toBe("All projects");
  });
});

describe("resolveSidebarNewChatAction", () => {
  const projectOne = scopeProjectRef(
    EnvironmentId.make("environment-one"),
    ProjectId.make("project-one"),
  );
  const projectOneRemote = scopeProjectRef(
    EnvironmentId.make("environment-two"),
    ProjectId.make("project-one-remote"),
  );
  const group = {
    id: projectOne.projectId,
    environmentId: projectOne.environmentId,
    memberProjectRefs: [projectOne, projectOneRemote],
  } satisfies Pick<SidebarProjectSnapshot, "id" | "environmentId" | "memberProjectRefs">;

  it("uses Chat: New for All projects", () => {
    expect(resolveSidebarNewChatAction(null, projectOne)).toEqual({
      command: "chat.new",
      projectRef: null,
    });
  });

  it("uses Chat: New Local with the selected project's contextual member", () => {
    expect(resolveSidebarNewChatAction(group, projectOneRemote)).toEqual({
      command: "chat.newLocal",
      projectRef: projectOneRemote,
    });
  });

  it("uses the selected project's representative outside its current context", () => {
    expect(
      resolveSidebarNewChatAction(
        group,
        scopeProjectRef(EnvironmentId.make("other-environment"), ProjectId.make("other-project")),
      ),
    ).toEqual({
      command: "chat.newLocal",
      projectRef: projectOne,
    });
  });
});
