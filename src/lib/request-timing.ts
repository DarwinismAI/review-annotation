export type RequestTimingPhase = "auth" | "profile" | "sql";

export interface RequestTiming {
  measure<T>(phase: RequestTimingPhase, work: () => Promise<T>): Promise<T>;
  header(): string;
}

const PHASES: RequestTimingPhase[] = ["auth", "profile", "sql"];

function formatDuration(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function createRequestTiming(now: () => number = () => performance.now()): RequestTiming {
  const startedAt = now();
  const durations = new Map<RequestTimingPhase, number>(PHASES.map((phase) => [phase, 0]));

  return {
    async measure<T>(phase: RequestTimingPhase, work: () => Promise<T>): Promise<T> {
      const phaseStartedAt = now();
      try {
        return await work();
      } finally {
        const elapsed = Math.max(0, now() - phaseStartedAt);
        durations.set(phase, (durations.get(phase) ?? 0) + elapsed);
      }
    },
    header() {
      const total = Math.max(0, now() - startedAt);
      return [
        ...PHASES.map((phase) => `${phase};dur=${formatDuration(durations.get(phase) ?? 0)}`),
        `total;dur=${formatDuration(total)}`,
      ].join(", ");
    },
  };
}
