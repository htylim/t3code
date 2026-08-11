import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { $createParagraphNode, $getRoot, createEditor } from "lexical";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  $createComposerThreadReferenceNode,
  ComposerThreadReferenceNode,
} from "./ComposerThreadReferenceNode";

describe("ComposerThreadReferenceNode", () => {
  it("renders a non-navigating thread chip", () => {
    const editor = createEditor({ nodes: [ComposerThreadReferenceNode] });
    let markup = "";

    editor.update(
      () => {
        const node = $createComposerThreadReferenceNode(
          {
            environmentId: EnvironmentId.make("local"),
            threadId: ThreadId.make("thread-1"),
          },
          "Release notes",
        );
        markup = renderToStaticMarkup(node.decorate());
      },
      { discrete: true },
    );

    expect(markup).toContain('data-composer-thread-reference-chip="true"');
    expect(markup).toContain("Release notes");
    expect(markup).not.toContain("href=");
  });

  it("serializes its chip back to the unchanged canonical Markdown", () => {
    const editor = createEditor({ nodes: [ComposerThreadReferenceNode] });
    const threadRef = {
      environmentId: EnvironmentId.make("local/environment"),
      threadId: ThreadId.make("thread/one"),
    };

    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append($createComposerThreadReferenceNode(threadRef, "Fix [copy] \\ now"));
        $getRoot().append(paragraph);
      },
      { discrete: true },
    );

    editor.getEditorState().read(() => {
      const node = $getRoot().getFirstDescendant();
      expect(node).toBeInstanceOf(ComposerThreadReferenceNode);
      expect(node?.getTextContent()).toBe(
        "[Fix \\[copy\\] \\\\ now](t3code://threads/local%2Fenvironment/thread%2Fone)",
      );
      expect((node as ComposerThreadReferenceNode).exportJSON()).toMatchObject({
        type: "composer-thread-reference",
        version: 1,
        threadRef,
        label: "Fix [copy] \\ now",
      });
    });
  });
});
