import { expect, it } from "vite-plus/test";
import { resolveWorktreeRenameIssue } from "./NamedWorktreeDialog.logic";

it.each(["", " ", ".", "..", "../beta", "nested/beta", "nested\\beta"])(
  "rejects invalid worktree directory %j",
  (name) => {
    expect(
      resolveWorktreeRenameIssue({ worktreePath: "/trees/alpha", name, existingPaths: [] }),
    ).toBe("Enter a directory name without path separators.");
  },
);

it("allows the current directory and names in a different parent", () => {
  expect(
    resolveWorktreeRenameIssue({
      worktreePath: "/trees/alpha",
      name: " alpha ",
      existingPaths: ["/trees/alpha"],
    }),
  ).toBeNull();
  expect(
    resolveWorktreeRenameIssue({
      worktreePath: "/trees/alpha",
      name: "beta",
      existingPaths: ["/other/beta"],
    }),
  ).toBeNull();
});

it.each([
  ["/trees/alpha", "/trees/beta"],
  ["C:\\trees\\alpha", "C:\\trees\\beta"],
])("rejects a sibling collision beside %s", (worktreePath, existingPath) => {
  expect(
    resolveWorktreeRenameIssue({ worktreePath, name: " beta ", existingPaths: [existingPath] }),
  ).toBe("A directory with that name already exists.");
});
