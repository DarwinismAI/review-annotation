"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tracks an open article_review_session for the given assignment.
 *
 * Lifecycle:
 * - mount  → POST /start, store sessionId
 * - visibilitychange hidden → sendBeacon /close-by-key (reason: blur)
 * - pagehide → sendBeacon /close-by-key (reason: navigate)
 * - unmount → PATCH /close (reason: navigate, best-effort fire-and-forget)
 *
 * Race: if sessionId is not yet set when a beacon fires, we no-op -
 * the server watchdog closes orphans within 90 minutes.
 */
export function useReviewSession(assignmentId: string): { sessionId: string | null } {
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Ref keeps the latest sessionId without triggering re-renders in event handlers
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    // No-op until the parent component has loaded the assignment
    if (!assignmentId) return;

    let cancelled = false;

    async function startSession() {
      try {
        const res = await fetch("/api/article-review-sessions/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignmentId }),
          credentials: "include",
        });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { sessionId?: string };
        if (json.sessionId && !cancelled) {
          sessionIdRef.current = json.sessionId;
          setSessionId(json.sessionId);
        }
      } catch {
        // Non-fatal - watchdog handles orphan cleanup
      }
    }

    startSession();

    function sendBeacon(reason: "navigate" | "blur") {
      const id = sessionIdRef.current;
      if (!id) return; // start still pending - watchdog will catch within 90 min
      const payload = JSON.stringify({ sessionId: id, reason });
      navigator.sendBeacon("/api/article-review-sessions/close-by-key", payload);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        sendBeacon("blur");
      }
    }

    function handlePageHide() {
      sendBeacon("navigate");
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);

      // Best-effort PATCH on unmount (navigate away via React router)
      const id = sessionIdRef.current;
      if (id) {
        fetch("/api/article-review-sessions/close", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: id, reason: "navigate" }),
          credentials: "include",
          keepalive: true,
        }).catch(() => {
          // Intentionally swallowed - best-effort only
        });
      }
    };
  }, [assignmentId]);

  return { sessionId };
}
