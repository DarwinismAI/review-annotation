"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface ScoreEntry {
  criterionId: string;
  score: number | null;
  reason: string;
}

interface UseAutoSaveOptions {
  articleId: string;
  paragraphId?: string | null;
  /** Interval in ms - default 30 000 */
  intervalMs?: number;
}

interface UseAutoSaveReturn {
  lastSaved: Date | null;
  isSaving: boolean;
  saveDraft: (scores: ScoreEntry[]) => Promise<void>;
}

const LS_KEY = (articleId: string, paragraphId?: string | null) =>
  `er-draft-${articleId}${paragraphId ? `-${paragraphId}` : ""}`;

/**
 * Auto-saves draft scores every 30 s when scores change.
 * Stores a backup copy in localStorage for offline resilience.
 * Calls POST /api/articles/:id/review/draft.
 */
export function useAutoSave({
  articleId,
  paragraphId = null,
  intervalMs = 30_000,
}: UseAutoSaveOptions): UseAutoSaveReturn {
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const latestScoresRef = useRef<ScoreEntry[]>([]);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const saveDraft = useCallback(
    async (scores: ScoreEntry[]) => {
      if (isSaving) return;
      setIsSaving(true);

      // Persist backup immediately (works offline)
      const lsKey = LS_KEY(articleId, paragraphId);
      try {
        localStorage.setItem(
          lsKey,
          JSON.stringify({ scores, savedAt: new Date().toISOString() })
        );
      } catch {
        // localStorage unavailable - ignore
      }

      try {
        const res = await fetch(`/api/articles/${articleId}/review/draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scores,
            ...(paragraphId ? { paragraphId } : {}),
          }),
        });

        if (res.ok) {
          const now = new Date();
          setLastSaved(now);
          dirtyRef.current = false;
          toast.success("Đã lưu nháp", { duration: 2000 });
        }
      } catch {
        // Network error - backup in localStorage already saved
      } finally {
        setIsSaving(false);
      }
    },
    [articleId, isSaving, paragraphId]
  );

  // Track latest scores without triggering re-render
  const updateScores = useCallback((scores: ScoreEntry[]) => {
    latestScoresRef.current = scores;
    dirtyRef.current = true;
  }, []);

  // Periodic auto-save
  useEffect(() => {
    timerRef.current = setInterval(() => {
      if (dirtyRef.current && latestScoresRef.current.length > 0) {
        saveDraft(latestScoresRef.current);
      }
    }, intervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [intervalMs, saveDraft]);

  // Save on page unload (best-effort)
  useEffect(() => {
    function handleBeforeUnload() {
      if (!dirtyRef.current || latestScoresRef.current.length === 0) return;
      const lsKey = LS_KEY(articleId, paragraphId);
      try {
        localStorage.setItem(
          lsKey,
          JSON.stringify({
            scores: latestScoresRef.current,
            savedAt: new Date().toISOString(),
          })
        );
      } catch {
        // ignore
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [articleId, paragraphId]);

  // Expose updateScores via the saveDraft overload so the panel can push scores
  // and still get the manual-save behavior. We return a combined saveDraft that
  // also marks dirty + updates ref.
  const saveDraftWithTracking = useCallback(
    async (scores: ScoreEntry[]) => {
      updateScores(scores);
      await saveDraft(scores);
    },
    [saveDraft, updateScores]
  );

  return { lastSaved, isSaving, saveDraft: saveDraftWithTracking };
}

/** Read a previously saved draft from localStorage (used on mount). */
export function readLocalDraft(
  articleId: string,
  paragraphId?: string | null
): { scores: ScoreEntry[]; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(LS_KEY(articleId, paragraphId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
