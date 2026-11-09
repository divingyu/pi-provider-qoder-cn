import type {
  AssistantMessage,
  AssistantMessageEventStream,
  TextContent,
  ThinkingContent,
} from "@earendil-works/pi-ai";

export const THINKING_TAG_VARIANTS: Array<{ open: string; close: string }> = [
  { open: "<thinking>", close: "</thinking>" },
  { open: "<think>", close: "</think>" },
  { open: "<reasoning>", close: "</reasoning>" },
  { open: "<thought>", close: "</thought>" },
];

const ALL_THINKING_TAGS: string[] = THINKING_TAG_VARIANTS.flatMap((variant) => [variant.open, variant.close]);

/**
 * Whether `text` contains a thinking closer with no opener before it in the
 * same text. Used by stream.ts to decide, before feeding the content channel
 * to this parser, whether the text preceding that closer is thinking (no
 * reasoning_content body this turn) or answer text (Qoder's M1 split, where
 * the opener and thinking already arrived via reasoning_content).
 */
/**
 * Whether `text` holds at least one complete thinking tag (opener or closer).
 * stream.ts uses this as the point where the content channel can be classified
 * and released from its buffer; a tag prefix split across deltas does not count.
 */
export function hasAnyCompleteThinkingTag(text: string): boolean {
  return THINKING_TAG_VARIANTS.some((variant) => text.includes(variant.open) || text.includes(variant.close));
}

export function hasOrphanThinkingCloser(text: string): boolean {
  for (const variant of THINKING_TAG_VARIANTS) {
    const closePos = text.indexOf(variant.close);
    if (closePos === -1) continue;
    const openerBefore = THINKING_TAG_VARIANTS.some((other) => {
      const openPos = text.indexOf(other.open);
      return openPos !== -1 && openPos < closePos;
    });
    if (!openerBefore) return true;
  }
  return false;
}

function getTrailingPossibleTagPrefixLength(text: string, tag: string): number {
  const maxPrefixLength = Math.min(text.length, tag.length - 1);
  for (let len = maxPrefixLength; len > 0; len--) {
    if (text.endsWith(tag.slice(0, len))) return len;
  }
  return 0;
}

function getMaxTrailingPossibleTagPrefixLength(text: string, tags: string[]): number {
  let maxLength = 0;
  for (const tag of tags) {
    maxLength = Math.max(maxLength, getTrailingPossibleTagPrefixLength(text, tag));
  }
  return maxLength;
}

/**
 * Remove every thinking/reasoning tag variant (open and close) from `text`.
 *
 * Qoder's backend sometimes routes a literal `<thinking>` opener into the
 * `reasoning_content` channel (and the matching `</thinking>` closer into the
 * `content` channel). Stripping these artifacts keeps the thinking block clean,
 * matching the SDK's `ContentBlock` model. Best-effort per chunk: a tag split
 * across stream deltas is not caught here (the ThinkingTagParser handles the
 * content-channel side with cross-delta buffering).
 */
export function stripThinkingTags(text: string): string {
  let out = text;
  for (const { open, close } of THINKING_TAG_VARIANTS) {
    if (open.length > 0 && out.includes(open)) out = out.split(open).join("");
    if (close.length > 0 && out.includes(close)) out = out.split(close).join("");
  }
  return out;
}

// Qoder's gateway occasionally fails to turn a model's tool-call intent into
// OpenAI-style `tool_calls` and leaks its internal DSML markup instead —
// closing tags, into whichever channel it was halfway through. Seen in the
// wild as a full-width DSML closing tag, a bare </invoke> or </parameter>, and
// </function_call>, alone or repeated dozens of times. Left in place they poison
// the thinking block, which the next turn replays into the prompt as a
// <thinking>...</thinking> text block.
const DSML_TAG =
  /<\/?[\uFF5C|]{0,2}\s*DSML\s*[\uFF5C|]{0,2}[^>]*>|<\/?(?:invoke|invocation|parameter|function_call|function_calls)\b[^>]*>/g;

// Two or more of those tags in a row at the end of the reasoning channel: the
// signature of a turn where the model tried to call a tool and the gateway
// dropped the call. A single literal tag inside prose does not match.
const DEGENERATE_DSML_TAIL =
  /(?:(?:<\/?(?:invoke|invocation|parameter|function_call|function_calls)\b[^>]*>)\s*|(?:<\/?[\uFF5C|]{0,2}\s*DSML\s*[\uFF5C|]{0,2}[^>]*>)\s*){2,}$/;

/**
 * Strip leaked DSML tool-call markup and collapse the blank lines it leaves.
 */
export function stripDsmlResidue(text: string): string {
  return text.replace(DSML_TAG, "").replace(/\n{3,}/g, "\n\n");
}

/**
 * Whether a finished turn is the degenerate case above: nothing usable came
 * back — no text, no executed tool call — and the reasoning channel ends in
 * leaked markup. `rawReasoning` is that channel before stripDsmlResidue ran,
 * because the residue is exactly what is being looked for.
 */
export function isDegenerateDsmlTurn(message: AssistantMessage, rawReasoning: string): boolean {
  if (message.stopReason === "toolUse") return false;
  const content = Array.isArray(message.content) ? message.content : [];
  if (content.some((block) => block.type === "text" && block.text.trim().length > 0)) return false;
  return DEGENERATE_DSML_TAIL.test(rawReasoning);
}

export class ThinkingTagParser {
  private textBuffer = "";
  private inThinking = false;
  private thinkingExtracted = false;
  private thinkingBlockIndex: number | null = null;
  private textBlockIndex: number | null = null;
  private lastTextBlockIndex: number | null = null;
  private activeEndTag: string = THINKING_TAG_VARIANTS[0].close;
  private orphanCloserMeansThinking = false;

  constructor(
    private output: AssistantMessage,
    private stream: AssistantMessageEventStream,
  ) {}

  /**
   * Must be called before the first `processChunk`.
   *
   * When the reasoning_content channel carried no thinking body this turn
   * (only a bare opener tag, or nothing at all), an orphan closer in the
   * content stream is preceded by THINKING text rather than answer text.
   * stream.ts decides this once, at the first content delta, because Qoder
   * sends the reasoning channel before the content channel.
   *
   * Default false preserves the historical behaviour: the opener and its
   * thinking text arrived via reasoning_content, so text before the orphan
   * closer in the content stream is visible answer text.
   */
  setOrphanCloserMeansThinking(value: boolean): void {
    this.orphanCloserMeansThinking = value;
  }

  processChunk(chunk: string): void {
    this.textBuffer += chunk;
    while (this.textBuffer.length > 0) {
      const prevLength = this.textBuffer.length;
      if (!this.inThinking && !this.thinkingExtracted) {
        this.processBeforeThinking();
        if (this.textBuffer.length === 0) break;
      }
      if (this.inThinking) {
        this.processInsideThinking();
        if (this.textBuffer.length === 0) break;
      }
      if (this.thinkingExtracted) {
        this.processAfterThinking();
        break;
      }
      if (this.textBuffer.length >= prevLength) break;
    }
  }

  finalize(): void {
    if (this.textBuffer.length === 0) return;
    if (this.inThinking && this.thinkingBlockIndex !== null) {
      const block = this.output.content[this.thinkingBlockIndex] as ThinkingContent;
      block.thinking += this.textBuffer;
      this.stream.push({
        type: "thinking_delta",
        contentIndex: this.thinkingBlockIndex,
        delta: this.textBuffer,
        partial: this.output,
      });
      this.stream.push({
        type: "thinking_end",
        contentIndex: this.thinkingBlockIndex,
        content: block.thinking,
        partial: this.output,
      });
    } else if (this.orphanCloserMeansThinking && !this.thinkingExtracted) {
      // Truncated before the orphan closer arrived: keep the buffered reasoning
      // in the thinking channel instead of leaking it into visible text.
      this.emitThinking(this.textBuffer);
      if (this.thinkingBlockIndex !== null) {
        const block = this.output.content[this.thinkingBlockIndex] as ThinkingContent;
        this.stream.push({
          type: "thinking_end",
          contentIndex: this.thinkingBlockIndex,
          content: block.thinking,
          partial: this.output,
        });
      }
    } else {
      this.emitText(this.textBuffer);
    }
    this.textBuffer = "";
  }

  getTextBlockIndex(): number | null {
    return this.textBlockIndex ?? this.lastTextBlockIndex;
  }

  private processBeforeThinking(): void {
    // Find the first opener and first closer in the buffer.
    let bestOpenPos = -1;
    let bestOpenVariant: (typeof THINKING_TAG_VARIANTS)[number] | null = null;
    let bestClosePos = -1;
    let bestCloseVariant: (typeof THINKING_TAG_VARIANTS)[number] | null = null;
    for (const variant of THINKING_TAG_VARIANTS) {
      const openPos = this.textBuffer.indexOf(variant.open);
      if (openPos !== -1 && (bestOpenPos === -1 || openPos < bestOpenPos)) {
        bestOpenPos = openPos;
        bestOpenVariant = variant;
      }
      const closePos = this.textBuffer.indexOf(variant.close);
      if (closePos !== -1 && (bestClosePos === -1 || closePos < bestClosePos)) {
        bestClosePos = closePos;
        bestCloseVariant = variant;
      }
    }

    // Opener comes first (or is the only tag): a real thinking block carried
    // in the content stream. Enter thinking mode; processInsideThinking will
    // handle its closer.
    if (bestOpenVariant !== null && (bestCloseVariant === null || bestOpenPos < bestClosePos)) {
      if (bestOpenPos > 0) this.emitText(this.textBuffer.slice(0, bestOpenPos));
      this.textBuffer = this.textBuffer.slice(bestOpenPos + bestOpenVariant.open.length);
      this.activeEndTag = bestOpenVariant.close;
      this.inThinking = true;
      return;
    }

    // Closer with no preceding opener: an orphan close tag. Its matching
    // opener was delivered via the separate `reasoning_content` channel (see
    // stream.ts), so there is no thinking block to close here. Drop it — and
    // the separator whitespace the model emits right after `</thinking>` — so
    // it does not leak into visible text.
    if (bestCloseVariant !== null) {
      if (this.orphanCloserMeansThinking && bestClosePos > 0) {
        // The opener was delivered out-of-band and the reasoning channel had no
        // body, so everything before this closer is the model's thinking. Put
        // it in a thinking block instead of leaking it into visible text.
        const thinkingText = this.textBuffer.slice(0, bestClosePos);
        this.emitThinking(thinkingText);
        if (this.thinkingBlockIndex !== null) {
          const block = this.output.content[this.thinkingBlockIndex] as ThinkingContent;
          this.stream.push({
            type: "thinking_end",
            contentIndex: this.thinkingBlockIndex,
            content: block.thinking,
            partial: this.output,
          });
          this.thinkingBlockIndex = null;
        }
        this.textBuffer = this.textBuffer.slice(bestClosePos + bestCloseVariant.close.length);
        if (this.textBuffer.startsWith("\n\n")) this.textBuffer = this.textBuffer.slice(2);
        else if (this.textBuffer.startsWith("\n")) this.textBuffer = this.textBuffer.slice(1);
        // Route the remainder through the post-thinking text path.
        this.thinkingExtracted = true;
        this.lastTextBlockIndex = this.textBlockIndex;
        this.textBlockIndex = null;
        return;
      }
      if (bestClosePos > 0) this.emitText(this.textBuffer.slice(0, bestClosePos));
      this.textBuffer = this.textBuffer.slice(bestClosePos + bestCloseVariant.close.length);
      if (this.textBuffer.startsWith("\n\n")) this.textBuffer = this.textBuffer.slice(2);
      else if (this.textBuffer.startsWith("\n")) this.textBuffer = this.textBuffer.slice(1);
      return;
    }

    // No complete tag yet. Hold back any trailing prefix that could be the
    // start of an opener OR a closer, so a tag split across stream deltas is
    // not partially emitted as text.
    const trailingPrefixLength = getMaxTrailingPossibleTagPrefixLength(this.textBuffer, ALL_THINKING_TAGS);
    const safeLen = this.textBuffer.length - trailingPrefixLength;
    if (safeLen > 0) {
      const safeText = this.textBuffer.slice(0, safeLen);
      if (this.orphanCloserMeansThinking) this.emitThinking(safeText);
      else this.emitText(safeText);
      this.textBuffer = this.textBuffer.slice(safeLen);
    }
  }

  private processInsideThinking(): void {
    const endPos = this.textBuffer.indexOf(this.activeEndTag);
    if (endPos !== -1) {
      if (endPos > 0) this.emitThinking(this.textBuffer.slice(0, endPos));
      if (this.thinkingBlockIndex !== null) {
        const block = this.output.content[this.thinkingBlockIndex] as ThinkingContent;
        this.stream.push({
          type: "thinking_end",
          contentIndex: this.thinkingBlockIndex,
          content: block.thinking,
          partial: this.output,
        });
      }
      this.textBuffer = this.textBuffer.slice(endPos + this.activeEndTag.length);
      this.inThinking = false;
      this.thinkingExtracted = true;
      this.lastTextBlockIndex = this.textBlockIndex;
      this.textBlockIndex = null;
      if (this.textBuffer.startsWith("\n\n")) this.textBuffer = this.textBuffer.slice(2);
      return;
    }

    const trailingPrefixLength = getTrailingPossibleTagPrefixLength(this.textBuffer, this.activeEndTag);
    const safeLen = this.textBuffer.length - trailingPrefixLength;
    if (safeLen > 0) {
      this.emitThinking(this.textBuffer.slice(0, safeLen));
      this.textBuffer = this.textBuffer.slice(safeLen);
    }
  }

  private processAfterThinking(): void {
    this.emitText(this.textBuffer);
    this.textBuffer = "";
  }

  private emitText(text: string): void {
    if (!text) return;
    if (this.textBlockIndex === null) {
      this.textBlockIndex = this.output.content.length;
      this.output.content.push({ type: "text", text: "" });
      this.stream.push({ type: "text_start", contentIndex: this.textBlockIndex, partial: this.output });
    }
    const block = this.output.content[this.textBlockIndex] as TextContent;
    block.text += text;
    this.stream.push({ type: "text_delta", contentIndex: this.textBlockIndex, delta: text, partial: this.output });
  }

  private emitThinking(thinking: string): void {
    if (!thinking) return;
    if (this.thinkingBlockIndex === null) {
      if (this.textBlockIndex !== null) {
        this.thinkingBlockIndex = this.textBlockIndex;
        this.output.content.splice(this.thinkingBlockIndex, 0, { type: "thinking", thinking: "" });
        this.textBlockIndex = this.textBlockIndex + 1;
      } else {
        this.thinkingBlockIndex = this.output.content.length;
        this.output.content.push({ type: "thinking", thinking: "" });
      }
      this.stream.push({ type: "thinking_start", contentIndex: this.thinkingBlockIndex, partial: this.output });
    }
    const block = this.output.content[this.thinkingBlockIndex] as ThinkingContent;
    block.thinking += thinking;
    this.stream.push({
      type: "thinking_delta",
      contentIndex: this.thinkingBlockIndex,
      delta: thinking,
      partial: this.output,
    });
  }
}
