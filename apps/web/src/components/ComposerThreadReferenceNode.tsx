import type { ScopedThreadRef } from "@t3tools/contracts";
import { Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { MessagesSquareIcon } from "lucide-react";
import { serializeThreadReferenceUri } from "../threadReference";
import {
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_DECORATOR_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
} from "./composerInlineChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/** Keeps a thread reference atomic while preserving its canonical Markdown source. */
export const ComposerThreadReferenceExtension = Node.create({
  name: "composer-thread-reference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  /** Stores the target separately from the text used for copying and sending. */
  addAttributes() {
    return { threadRef: { default: null }, label: { default: "" }, source: { default: "" } };
  },
  /** Recognizes thread chips in editor HTML. */
  parseHTML() {
    return [{ tag: "span[data-composer-thread-reference]" }];
  },
  /** Writes the inline marker used by the editor's DOM serializer. */
  renderHTML({ HTMLAttributes }) {
    return ["span", { "data-composer-thread-reference": "", ...HTMLAttributes }];
  },
  /** Renders the same chip in plain and rich text modes. */
  addNodeView() {
    return ReactNodeViewRenderer(ComposerThreadReferenceView);
  },
});

/** Displays a thread reference without navigating away from the draft. */
function ComposerThreadReferenceView({ node }: NodeViewProps) {
  const chip = (
    <span
      className={COMPOSER_INLINE_CHIP_CLASS_NAME}
      contentEditable={false}
      spellCheck={false}
      data-composer-thread-reference-chip="true"
    >
      <MessagesSquareIcon className={COMPOSER_INLINE_CHIP_ICON_CLASS_NAME} aria-hidden="true" />
      <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>{node.attrs.label as string}</span>
    </span>
  );

  return (
    <NodeViewWrapper as="span" className={COMPOSER_INLINE_CHIP_DECORATOR_CLASS_NAME}>
      <Tooltip>
        <TooltipTrigger render={chip} />
        <TooltipPopup
          side="top"
          className="max-w-120 whitespace-normal leading-tight wrap-anywhere"
        >
          {serializeThreadReferenceUri(node.attrs.threadRef as ScopedThreadRef)}
        </TooltipPopup>
      </Tooltip>
    </NodeViewWrapper>
  );
}
