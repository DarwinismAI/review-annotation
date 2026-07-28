"use client";

import { useEffect, useRef, useState } from "react";
import type { SelectionState } from "@/hooks/use-text-selection";

const MAX_COMMENT_LEN = 1000;

interface InlineCommentComposerProps {
  /** Selection that triggered this composer */
  selection: SelectionState;
  /** Called when user saves; receives the comment body text */
  onSave: (body: string) => void | Promise<void>;
  /** Called when user cancels or presses Escape */
  onClose: () => void;
}

/**
 * Floating popover composer for inline comments.
 *
 * Positioned at the bottom of the text selection (page coords).
 * Closes on Escape, saves on Cmd/Ctrl+Enter, click-outside cancels.
 */
export function InlineCommentComposer({
  selection,
  onSave,
  onClose,
}: InlineCommentComposerProps) {
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Auto-focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Close on click-outside (slight delay to avoid closing on the triggering mouseup)
  useEffect(() => {
    let mounted = true;
    const timer = setTimeout(() => {
      if (!mounted) return;
      function onMouseDown(e: MouseEvent) {
        if (!popoverRef.current?.contains(e.target as Node)) {
          onClose();
        }
      }
      document.addEventListener("mousedown", onMouseDown, true);
      return () => document.removeEventListener("mousedown", onMouseDown, true);
    }, 100);
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [onClose]);

  async function handleSave() {
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > MAX_COMMENT_LEN) return;
    setSaving(true);
    try {
      await onSave(trimmed);
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
  }

  const charCount = body.length;
  const overLimit = charCount > MAX_COMMENT_LEN;
  const canSave = charCount >= 1 && !overLimit && !saving;

  // Position: anchor below the selection bounding box (page coords)
  const top = selection.rect.bottom + 12;
  const left = Math.max(
    8,
    Math.min(selection.rect.left, (typeof window !== "undefined" ? window.innerWidth : 800) - 376)
  );

  // Truncate selected text for preview
  const preview =
    selection.text.length > 80
      ? selection.text.substring(0, 80) + "…"
      : selection.text;

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Thêm comment"
      onKeyDown={onKeyDown}
      style={{
        position: "absolute",
        top,
        left,
        zIndex: 1000,
        width: 360,
        maxWidth: "calc(100vw - 32px)",
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        boxShadow: "0 20px 60px -10px rgba(0,0,0,0.18), 0 4px 16px -4px rgba(0,0,0,0.1)",
        padding: "14px 16px",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#1e293b", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Thêm comment
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng"
          style={{
            fontSize: 18,
            lineHeight: 1,
            color: "#94a3b8",
            background: "transparent",
            border: "none",
            padding: "2px 6px",
            cursor: "pointer",
            borderRadius: 4,
          }}
        >
          &times;
        </button>
      </div>

      {/* Selected text preview */}
      <div
        title={selection.text}
        style={{
          fontSize: 12,
          color: "#64748b",
          background: "#fefce8",
          borderLeft: "3px solid #fde047",
          padding: "6px 10px",
          borderRadius: 4,
          marginBottom: 10,
          lineHeight: 1.5,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        &ldquo;{preview}&rdquo;
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Nhập nhận xét của bạn..."
        maxLength={MAX_COMMENT_LEN + 1} // allow typing 1 extra to show error
        rows={4}
        style={{
          width: "100%",
          border: `1px solid ${overLimit ? "#ef4444" : "#e2e8f0"}`,
          borderRadius: 8,
          padding: "8px 10px",
          fontSize: 13,
          color: "#1e293b",
          lineHeight: 1.6,
          resize: "none",
          outline: "none",
          fontFamily: "inherit",
          boxSizing: "border-box",
        }}
      />

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 12 }}>
        <span
          style={{
            fontSize: 11,
            color: overLimit ? "#ef4444" : "#94a3b8",
            fontWeight: overLimit ? 600 : 400,
          }}
        >
          {charCount} / {MAX_COMMENT_LEN}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 7,
              cursor: "pointer",
              color: "#64748b",
              background: "transparent",
              border: "1px solid #e2e8f0",
            }}
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 7,
              cursor: canSave ? "pointer" : "not-allowed",
              color: "#fff",
              background: canSave ? "#3b82f6" : "#cbd5e1",
              border: `1px solid ${canSave ? "#3b82f6" : "#cbd5e1"}`,
            }}
          >
            {saving ? "Đang lưu…" : "Lưu"}
          </button>
        </div>
      </div>
    </div>
  );
}
