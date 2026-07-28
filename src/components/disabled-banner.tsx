"use client";

import { useEffect, useState } from "react";

/**
 * Sticky amber banner shown on the review page when admin has toggled the article off.
 *
 * - During the 24h grace window: shows live countdown ("còn 23h 12m") + lets review proceed.
 * - After grace expires: emits `onExpire` so parent can lock the page to read-only.
 *
 * `disabledAt` is the ISO timestamp from the toggle endpoint. Banner is hidden when
 * `disabledAt` is null (article still enabled).
 */
export interface DisabledBannerProps {
  disabledAt: string | null;
  onExpire?: () => void;
}

const GRACE_MS = 24 * 60 * 60 * 1000;

function formatRemaining(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours > 0) return `${hours} giờ ${minutes.toString().padStart(2, "0")} phút`;
  return `${minutes} phút`;
}

export function DisabledBanner({ disabledAt, onExpire }: DisabledBannerProps) {
  const [now, setNow] = useState(() => Date.now());

  // Tick once a minute while we have a disabledAt; cleanup runs on unmount/change.
  useEffect(() => {
    if (!disabledAt) return;
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, [disabledAt]);

  const disabledTs = disabledAt ? Date.parse(disabledAt) : NaN;
  const remaining = !isNaN(disabledTs) ? disabledTs + GRACE_MS - now : Number.POSITIVE_INFINITY;

  // Fire `onExpire` exactly when window crosses zero.
  useEffect(() => {
    if (Number.isFinite(remaining) && remaining <= 0) onExpire?.();
  }, [remaining, onExpire]);

  if (!disabledAt || isNaN(disabledTs)) return null;

  if (remaining <= 0) {
    return (
      <div className="sticky top-16 z-30 bg-red-50 border-y border-red-200 px-6 py-3">
        <p className="text-sm text-red-800 font-medium max-w-7xl mx-auto">
          Bài đã bị vô hiệu hóa quá 24 giờ - chuyển sang chế độ chỉ đọc.
        </p>
      </div>
    );
  }

  return (
    <div className="sticky top-16 z-30 bg-amber-50 border-y border-amber-200 px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center gap-3">
        <svg
          className="w-5 h-5 text-amber-600 shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <p className="text-sm text-amber-800 font-medium">
          Bài đã bị admin tắt. Bạn có{" "}
          <span className="font-semibold">{formatRemaining(remaining)}</span> để hoàn thành review trước khi chuyển sang chế độ chỉ đọc.
        </p>
      </div>
    </div>
  );
}
