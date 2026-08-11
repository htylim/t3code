import type { ScopedThreadRef } from "@t3tools/contracts";
import { MessagesSquareIcon } from "lucide-react";
import {
  $applyNodeReplacement,
  DecoratorNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import type { ReactElement } from "react";

import { serializeThreadReferenceMarkdown, serializeThreadReferenceUri } from "../threadReference";
import {
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
} from "./composerInlineChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

type SerializedComposerThreadReferenceNode = Spread<
  {
    threadRef: ScopedThreadRef;
    label: string;
    type: "composer-thread-reference";
    version: 1;
  },
  SerializedLexicalNode
>;

function ComposerThreadReferenceDecorator(props: {
  readonly threadRef: ScopedThreadRef;
  readonly label: string;
}) {
  const chip = (
    <span
      className={COMPOSER_INLINE_CHIP_CLASS_NAME}
      contentEditable={false}
      spellCheck={false}
      data-composer-thread-reference-chip="true"
    >
      <MessagesSquareIcon className={COMPOSER_INLINE_CHIP_ICON_CLASS_NAME} aria-hidden="true" />
      <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>{props.label}</span>
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup side="top" className="max-w-120 whitespace-normal leading-tight wrap-anywhere">
        {serializeThreadReferenceUri(props.threadRef)}
      </TooltipPopup>
    </Tooltip>
  );
}

export class ComposerThreadReferenceNode extends DecoratorNode<ReactElement> {
  __threadRef: ScopedThreadRef;
  __label: string;

  static override getType(): string {
    return "composer-thread-reference";
  }

  static override clone(node: ComposerThreadReferenceNode): ComposerThreadReferenceNode {
    return new ComposerThreadReferenceNode(node.__threadRef, node.__label, node.__key);
  }

  static override importJSON(
    serializedNode: SerializedComposerThreadReferenceNode,
  ): ComposerThreadReferenceNode {
    return $createComposerThreadReferenceNode(
      serializedNode.threadRef,
      serializedNode.label,
    ).updateFromJSON(serializedNode);
  }

  constructor(threadRef: ScopedThreadRef, label: string, key?: NodeKey) {
    super(key);
    this.__threadRef = threadRef;
    this.__label = label;
  }

  override exportJSON(): SerializedComposerThreadReferenceNode {
    return {
      ...super.exportJSON(),
      threadRef: this.__threadRef,
      label: this.__label,
      type: "composer-thread-reference",
      version: 1,
    };
  }

  override createDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = "composer-inline-chip relative inline-flex align-[-0.125em] leading-none";
    return dom;
  }

  override updateDOM(): false {
    return false;
  }

  override getTextContent(): string {
    return serializeThreadReferenceMarkdown(this.__label, this.__threadRef);
  }

  override isInline(): true {
    return true;
  }

  override decorate(): ReactElement {
    return <ComposerThreadReferenceDecorator threadRef={this.__threadRef} label={this.__label} />;
  }
}

export function $createComposerThreadReferenceNode(
  threadRef: ScopedThreadRef,
  label: string,
): ComposerThreadReferenceNode {
  return $applyNodeReplacement(new ComposerThreadReferenceNode(threadRef, label));
}
