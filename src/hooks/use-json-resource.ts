"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

interface JsonResourceState<T> {
  data: T;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: Dispatch<SetStateAction<T>>;
}

function getErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return "Không tải được dữ liệu";
  }

  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string") return error;

  if (error && typeof error === "object") {
    const detail = error as { message?: unknown; code?: unknown };
    if (typeof detail.message === "string") return detail.message;
    if (typeof detail.code === "string") return detail.code;
  }

  return "Không tải được dữ liệu";
}

export async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error("Không tải được dữ liệu từ máy chủ");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Không tải được dữ liệu từ máy chủ");
  }
}

export function useJsonResource<T>(url: string, initialData: T): JsonResourceState<T> {
  const [data, setData] = useState<T>(initialData);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(url, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        let payload: unknown = null;
        try {
          payload = await readJsonResponse(response);
        } catch (parseError) {
          if (response.ok) throw parseError;
        }
        if (!response.ok) {
          throw new Error(getErrorMessage(payload));
        }
        if (active) setData(payload as T);
      } catch (loadError) {
        if (controller.signal.aborted || !active) return;
        setError(loadError instanceof Error ? loadError.message : "Không tải được dữ liệu");
      } finally {
        if (active && !controller.signal.aborted) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [url, version]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);

  return { data, error, loading, reload, setData };
}
