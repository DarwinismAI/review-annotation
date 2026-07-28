"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type TimePhase = "reading" | "scoring";

interface TimeEvent {
  type:
    | "reading_start"
    | "reading_pause"
    | "scoring_start"
    | "scoring_pause"
    | "tab_hidden"
    | "tab_visible";
  timestamp: string;
  paragraphId?: string | null;
}

interface UseTimeTrackerOptions {
  articleId: string;
  paragraphId?: string | null;
}

interface UseTimeTrackerReturn {
  readingTime: number; // seconds
  scoringTime: number; // seconds
  currentPhase: TimePhase;
  switchPhase: (phase: TimePhase) => void;
}

/**
 * Tracks reading vs scoring time for an article review session.
 * Auto-detects phase via `switchPhase` (called by panels on focus/interaction).
 * Pauses on tab hidden (visibilitychange).
 * Batches events and sends to POST /api/articles/:id/time-events every 30s.
 */
export function useTimeTracker({
  articleId,
  paragraphId = null,
}: UseTimeTrackerOptions): UseTimeTrackerReturn {
  const [readingTime, setReadingTime] = useState(0);
  const [scoringTime, setScoringTime] = useState(0);
  const [currentPhase, setCurrentPhase] = useState<TimePhase>("reading");

  const phaseRef = useRef<TimePhase>("reading");
  const lastTickRef = useRef<number>(Date.now());
  const pausedRef = useRef<boolean>(false);
  const pendingEvents = useRef<TimeEvent[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pushEvent = useCallback(
    (type: TimeEvent["type"]) => {
      pendingEvents.current.push({
        type,
        timestamp: new Date().toISOString(),
        paragraphId,
      });
    },
    [paragraphId]
  );

  const flushEvents = useCallback(async () => {
    if (pendingEvents.current.length === 0) return;
    const events = pendingEvents.current.splice(0);
    try {
      await fetch(`/api/articles/${articleId}/time-events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events }),
      });
    } catch {
      // silently restore events so they retry next flush
      pendingEvents.current.unshift(...events);
    }
  }, [articleId]);

  // Tick every second to accumulate time
  useEffect(() => {
    tickTimerRef.current = setInterval(() => {
      if (pausedRef.current) return;
      const now = Date.now();
      const delta = Math.round((now - lastTickRef.current) / 1000);
      lastTickRef.current = now;
      if (phaseRef.current === "reading") {
        setReadingTime((t) => t + delta);
      } else {
        setScoringTime((t) => t + delta);
      }
    }, 1000);

    return () => {
      if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    };
  }, []);

  // Flush events every 30s
  useEffect(() => {
    pushEvent("reading_start");
    flushTimerRef.current = setInterval(flushEvents, 30_000);
    return () => {
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
      flushEvents(); // flush on unmount
    };
  }, [flushEvents, pushEvent]);

  // Tab visibility pause/resume
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden) {
        pausedRef.current = true;
        pushEvent("tab_hidden");
        flushEvents();
      } else {
        pausedRef.current = false;
        lastTickRef.current = Date.now();
        pushEvent("tab_visible");
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushEvents, pushEvent]);

  const switchPhase = useCallback(
    (phase: TimePhase) => {
      if (phaseRef.current === phase) return;
      const pauseEvent =
        phaseRef.current === "reading" ? "reading_pause" : "scoring_pause";
      const startEvent = phase === "reading" ? "reading_start" : "scoring_start";
      pushEvent(pauseEvent);
      pushEvent(startEvent);
      phaseRef.current = phase;
      setCurrentPhase(phase);
      lastTickRef.current = Date.now();
    },
    [pushEvent]
  );

  return { readingTime, scoringTime, currentPhase, switchPhase };
}
