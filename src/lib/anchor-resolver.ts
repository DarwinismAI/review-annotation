/**
 * anchor-resolver.ts
 *
 * Hybrid anchor resolution for inline comment marks.
 *
 * Strategy (matches prototype selection-comment.js resolveAnchor):
 *  1. Try anchorOffsetStart..anchorOffsetEnd first — fast, exact when the DOM
 *     is unchanged.
 *  2. If the quoted text at that position doesn't match, fall back to fuzzy
 *     search: indexOf(quote) inside the container's textContent.
 *  3. If still not found, return null (comment is silently skipped).
 */

export interface AnchorData {
  /** Exact quoted text — primary resolution key */
  quote: string;
  /** ~30 chars before the quote (context for disambiguation) */
  prefix?: string | null;
  /** ~30 chars after the quote (context for disambiguation) */
  suffix?: string | null;
  /** Best-effort byte offset of quote start in the container's textContent */
  offsetStart?: number | null;
  /** Best-effort byte offset of quote end */
  offsetEnd?: number | null;
}

/**
 * Resolve an AnchorData to a live DOM Range within `container`.
 *
 * @param anchor - Stored anchor fields from the DB row.
 * @param container - The element whose `textContent` is searched.
 * @returns A Range spanning the anchor, or null if not resolvable.
 */
export function resolveAnchor(anchor: AnchorData, container: Element): Range | null {
  const fullText = container.textContent ?? "";
  const quote = anchor.quote;
  if (!quote) return null;

  let charOffset = -1;

  // Strategy 1: try stored offset
  if (
    typeof anchor.offsetStart === "number" &&
    anchor.offsetStart >= 0 &&
    fullText.substring(anchor.offsetStart, anchor.offsetStart + quote.length) === quote
  ) {
    charOffset = anchor.offsetStart;
  }

  // Strategy 2: simple indexOf
  if (charOffset < 0) {
    const idx = fullText.indexOf(quote);
    if (idx >= 0) charOffset = idx;
  }

  // Strategy 3: fuzzy — try prefix+quote, suffix+quote to pick right occurrence
  if (charOffset < 0 && anchor.prefix) {
    const combined = (anchor.prefix ?? "") + quote;
    const idx = fullText.indexOf(combined);
    if (idx >= 0) charOffset = idx + (anchor.prefix?.length ?? 0);
  }

  if (charOffset < 0) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[anchor-resolver] Cannot resolve anchor:", quote.substring(0, 40));
    }
    return null;
  }

  return charOffsetToRange(container, charOffset, quote.length);
}

/**
 * Walk text nodes inside `container` and produce a Range for the character
 * range [startOffset, startOffset + length).
 */
function charOffsetToRange(
  container: Element,
  startOffset: number,
  length: number
): Range | null {
  const range = document.createRange();
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);

  let charCount = 0;
  let startSet = false;
  let node: Text | null;

  while ((node = walker.nextNode() as Text | null)) {
    const nodeLen = node.textContent?.length ?? 0;
    const nodeEnd = charCount + nodeLen;

    if (!startSet && startOffset < nodeEnd) {
      range.setStart(node, startOffset - charCount);
      startSet = true;
    }

    if (startSet && startOffset + length <= nodeEnd) {
      range.setEnd(node, startOffset + length - charCount);
      return range;
    }

    charCount = nodeEnd;
  }

  return null;
}

/**
 * Build an AnchorData from a live Range within a container element.
 * Used when saving a new comment.
 */
export function buildAnchorData(range: Range, container: Element): AnchorData {
  return buildAnchorDataFromQuote(range.toString(), container);
}

/**
 * Build an AnchorData from a known quote string + container, without needing a
 * live DOM Range. Used when the original selection was captured earlier (e.g.
 * cached by `useTextSelection`) and the live `window.getSelection()` may have
 * been collapsed by focus moving to the composer textarea.
 */
export function buildAnchorDataFromQuote(quote: string, container: Element): AnchorData {
  const CONTEXT = 32;
  const fullText = container.textContent ?? "";

  const offset = quote ? fullText.indexOf(quote) : -1;
  const prefix =
    offset >= 0 ? fullText.substring(Math.max(0, offset - CONTEXT), offset) : "";
  const suffix =
    offset >= 0
      ? fullText.substring(offset + quote.length, offset + quote.length + CONTEXT)
      : "";

  return {
    quote,
    prefix,
    suffix,
    offsetStart: Math.max(0, offset),
    offsetEnd: Math.max(0, offset) + quote.length,
  };
}

/**
 * Wrap a DOM Range with a <mark> element.
 * Handles partial ranges (boundary crossing) gracefully.
 */
export function wrapRangeWithMark(
  range: Range,
  commentId: string
): HTMLElement | null {
  const mark = createMarkElement(commentId);
  try {
    range.surroundContents(mark);
    return mark;
  } catch {
    // Boundary crossing: extract text nodes, wrap as plain text mark
    const text = range.toString();
    const fallback = createMarkElement(commentId);
    fallback.textContent = text;
    range.deleteContents();
    range.insertNode(fallback);
    return fallback;
  }
}

function createMarkElement(commentId: string): HTMLElement {
  const mark = document.createElement("mark");
  mark.className = "comment-anchor";
  mark.dataset.commentId = commentId;
  mark.tabIndex = 0;
  mark.setAttribute("role", "button");
  mark.setAttribute("aria-label", "Xem comment");
  return mark;
}

/** Remove all existing comment-anchor marks in a container by unwrapping them. */
export function clearMarks(container: Element): void {
  container.querySelectorAll("mark.comment-anchor").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
  });
}
