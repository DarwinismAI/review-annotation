"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MAX_COMMENT_LEN = 1000;

export interface SelectionState {
  /** Raw selected text */
  text: string;
  /** Bounding rect of selection (page coordinates — not viewport) */
  rect: DOMRect;
  /** The container element with data-anchor-root attribute */
  containerEl: Element;
  /** data-section-id on the container (or its ancestor) */
  sectionId: string;
}

interface UseTextSelectionReturn {
  /** Current valid selection (null when nothing is selected) */
  selection: SelectionState | null;
  /** Composer is open */
  isActive: boolean;
  /** Programmatically open the composer for the given selection */
  openComposer: (sel: SelectionState) => void;
  /** Programmatically close the composer */
  closeComposer: () => void;
}

/**
 * Tracks text selections within elements that have the `data-anchor-root` attribute.
 * Listens for the `c` key to signal "open composer" (see `isActive`).
 *
 * The hook does NOT render UI — it only tracks state. The consumer decides
 * when to open the InlineCommentComposer.
 */
export function useTextSelection(): UseTextSelectionReturn {
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [isActive, setIsActive] = useState(false);

  // Cache the last valid selection so `c` still fires after focus shifts to a button.
  const lastValidRef = useRef<SelectionState | null>(null);
  const isActiveRef = useRef(false);

  // Keep isActiveRef in sync without triggering extra effects
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  /** Return the container with data-anchor-root that encloses `node`, or null. */
  function findAnchorRoot(node: Node): Element | null {
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
    return el?.closest("[data-anchor-root]") ?? null;
  }

  /** Extract a sectionId from the container or its ancestors. */
  function extractSectionId(el: Element): string {
    const sectionEl = el.closest("[data-section-id]");
    return sectionEl?.getAttribute("data-section-id") ?? "sec-0";
  }

  /** Read and validate current window selection. */
  function readSelection(): SelectionState | null {
    const winSel = window.getSelection();
    if (!winSel || winSel.isCollapsed || winSel.rangeCount === 0) return null;

    const range = winSel.getRangeAt(0);
    const text = range.toString();
    if (!text.trim()) return null;
    if (text.length > MAX_COMMENT_LEN) return null;

    // Both endpoints must live inside the SAME data-anchor-root container
    const startRoot = findAnchorRoot(range.startContainer);
    const endRoot = findAnchorRoot(range.endContainer);
    if (!startRoot || !endRoot || startRoot !== endRoot) return null;

    const rect = range.getBoundingClientRect();
    // Convert viewport-relative rect to page-coords
    const pageRect = new DOMRect(
      rect.left + window.scrollX,
      rect.top + window.scrollY,
      rect.width,
      rect.height
    );

    return {
      text,
      rect: pageRect,
      containerEl: startRoot,
      sectionId: extractSectionId(startRoot),
    };
  }

  // --- Selection change listener ---
  useEffect(() => {
    function onSelectionChange() {
      const sel = readSelection();
      setSelection(sel);
      if (sel) lastValidRef.current = sel;
    }

    function onMouseUp() {
      const sel = readSelection();
      if (sel) lastValidRef.current = sel;
    }

    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("mouseup", onMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Keyboard shortcut `c` ---
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "c") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const tag = (document.activeElement?.tagName ?? "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (document.activeElement?.getAttribute("contenteditable") === "true") return;

      if (isActiveRef.current) return; // composer already open

      const sel = lastValidRef.current;
      if (!sel) return;

      e.preventDefault();
      setIsActive(true);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const openComposer = useCallback((sel: SelectionState) => {
    lastValidRef.current = sel;
    setIsActive(true);
  }, []);

  const closeComposer = useCallback(() => {
    setIsActive(false);
    // Drop cached selection so repeated `c` presses don't reopen stale anchor
    lastValidRef.current = null;
    setSelection(null);
  }, []);

  return {
    selection: isActive ? lastValidRef.current : selection,
    isActive,
    openComposer,
    closeComposer,
  };
}
