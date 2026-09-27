import { Link } from "@tanstack/react-router";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { MessagesSquareIcon } from "lucide-react";
import { memo } from "react";

import { ContextChip, ContextChipLabel } from "../ContextChip";
import { cn } from "~/lib/utils";

/** Opens a scoped thread while copying its canonical Markdown reference. */
export const ThreadReferenceLink = memo(function ThreadReferenceLink(props: {
  readonly threadRef: ScopedThreadRef;
  readonly label: string;
  readonly copyMarkdown: string;
  readonly className?: string;
}) {
  return (
    <ContextChip
      kind="neutral"
      render={<Link to="/$environmentId/$threadId" params={props.threadRef} />}
      className={cn("chat-markdown-thread-reference no-underline", props.className)}
      data-markdown-copy={props.copyMarkdown}
    >
      <MessagesSquareIcon aria-hidden="true" />
      <ContextChipLabel>{props.label}</ContextChipLabel>
    </ContextChip>
  );
});
