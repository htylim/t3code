import { Link } from "@tanstack/react-router";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { MessagesSquareIcon } from "lucide-react";
import { memo } from "react";

import {
  CHAT_INLINE_CHIP_CLASS_NAME,
  CHAT_INLINE_CHIP_LABEL_CLASS_NAME,
} from "../composerInlineChip";
import { cn } from "~/lib/utils";

export const ThreadReferenceLink = memo(function ThreadReferenceLink(props: {
  readonly threadRef: ScopedThreadRef;
  readonly label: string;
  readonly copyMarkdown: string;
  readonly className?: string;
}) {
  return (
    <Link
      to="/$environmentId/$threadId"
      params={{
        environmentId: props.threadRef.environmentId,
        threadId: props.threadRef.threadId,
      }}
      className={cn(
        CHAT_INLINE_CHIP_CLASS_NAME,
        "chat-markdown-thread-reference text-foreground no-underline transition-colors hover:bg-accent/70",
        props.className,
      )}
      data-markdown-copy={props.copyMarkdown}
    >
      <MessagesSquareIcon className="size-[1.17em] shrink-0 opacity-85" aria-hidden="true" />
      <span className={CHAT_INLINE_CHIP_LABEL_CLASS_NAME}>{props.label}</span>
    </Link>
  );
});
