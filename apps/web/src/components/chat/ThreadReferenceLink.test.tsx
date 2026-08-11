import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { serializeThreadReferenceMarkdown } from "../../threadReference";
import { ThreadReferenceLink } from "./ThreadReferenceLink";

describe("ThreadReferenceLink", () => {
  it("renders a same-origin route while retaining canonical Markdown for copying", async () => {
    const threadRef = {
      environmentId: EnvironmentId.make("local/environment"),
      threadId: ThreadId.make("thread/one"),
    };
    const copyMarkdown = serializeThreadReferenceMarkdown("Referenced thread", threadRef);
    const rootRoute = createRootRoute();
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => (
        <ThreadReferenceLink
          threadRef={threadRef}
          label="Referenced thread"
          copyMarkdown={copyMarkdown}
        />
      ),
    });
    const targetRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/$environmentId/$threadId",
      component: () => null,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([indexRoute, targetRoute]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();

    const markup = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(markup).toContain('href="/local%2Fenvironment/thread%2Fone"');
    expect(markup).toContain(
      'data-markdown-copy="[Referenced thread](t3code://threads/local%2Fenvironment/thread%2Fone)"',
    );
    expect(markup).toContain("chat-markdown-thread-reference");
    expect(markup).not.toContain('href="t3code:');
    expect(markup).not.toContain("onClick");
  });
});
