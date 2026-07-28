"use client";

import { useState } from "react";

/**
 * Inline switch that flips an article's `enabled` flag via PATCH /api/articles/:id/toggle.
 *
 * Optimistic update with rollback-on-error. When toggled off, the parent expects to refresh
 * counts (calls `onChange` with the new value plus the server-returned `disabledAt`).
 */
export interface ArticleToggleProps {
  articleId: string;
  enabled: boolean;
  disabled?: boolean;
  onChange?: (next: boolean, disabledAt: string | null) => void;
}

export function ArticleToggle({ articleId, enabled, disabled, onChange }: ArticleToggleProps) {
  const [value, setValue] = useState(enabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    if (pending || disabled) return;
    setPending(true);
    setError(null);
    setValue(next); // optimistic
    try {
      const res = await fetch(`/api/articles/${articleId}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const json = (await res.json()) as {
        data?: { enabled: boolean; disabledAt: string | null };
        error?: { message?: string };
      };
      if (!res.ok || !json.data) {
        setValue(!next); // rollback
        setError(json.error?.message ?? "Không cập nhật được");
        return;
      }
      onChange?.(json.data.enabled, json.data.disabledAt);
    } catch {
      setValue(!next);
      setError("Lỗi mạng");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={value ? "Tắt bài viết" : "Bật bài viết"}
        disabled={pending || disabled}
        onClick={() => toggle(!value)}
        className={
          "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-50 " +
          (value ? "bg-blue-600" : "bg-slate-300")
        }
      >
        <span
          className={
            "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform " +
            (value ? "translate-x-5" : "translate-x-1")
          }
        />
      </button>
      {error ? <span className="text-xs text-red-500">{error}</span> : null}
    </div>
  );
}
