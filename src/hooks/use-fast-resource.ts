"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { readJsonResponse } from "./use-json-resource";

export type FastResourceStatus = "idle" | "loading" | "ready" | "refreshing" | "error";

const DEFAULT_TTL_MS = 30000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();
let currentSessionId: string | null = null;

interface FastResourceState<T> {
  data: T;
  error: string | null;
  status: FastResourceStatus;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  reload: () => void;
  setData: Dispatch<SetStateAction<T>>;
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : "Không tải được dữ liệu";
}

function messageFromPayload(payload: unknown) {
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

export function invalidateFastResource(prefix: string) {
  for (const key of cache.keys()) {
    const url = key.slice(key.indexOf(":") + 1);
    if (url.startsWith(prefix)) cache.delete(key);
  }
}

export function clearFastResourceCache() {
  cache.clear();
}

export function setFastResourceSession(userId: string | null) {
  if (currentSessionId === userId) return;
  clearFastResourceCache();
  currentSessionId = userId;
}

function fastResourceKey(sessionId: string | null, url: string) {
  return `${sessionId ?? "anonymous"}:${url}`;
}

export function useFastResource<T>(url: string, initialData: T, ttlMs = DEFAULT_TTL_MS): FastResourceState<T> {
  const key = fastResourceKey(currentSessionId, url);
  const cached = cache.get(key);
  const now = Date.now();
  const hasFreshCache = Boolean(cached && cached.expiresAt > now);
  const initializedRef = useRef(hasFreshCache);
  const lastUrlRef = useRef(url);
  const [state, setState] = useState<{ data: T; error: string | null; status: FastResourceStatus }>(() => ({
    data: hasFreshCache ? (cached!.value as T) : initialData,
    error: null,
    status: hasFreshCache ? "ready" : "loading",
  }));
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const sessionKey = fastResourceKey(currentSessionId, url);
    const cachedValue = cache.get(sessionKey);
    const fresh = cachedValue && cachedValue.expiresAt > Date.now();
    const forceReload = version > 0;

    if (fresh && !forceReload) {
      initializedRef.current = true;
      lastUrlRef.current = url;
      setState({ data: cachedValue.value as T, error: null, status: "ready" });
      return () => {
        active = false;
        controller.abort();
      };
    }

    const sameUrl = lastUrlRef.current === url;
    setState((current) => ({
      ...current,
      error: null,
      status: initializedRef.current && sameUrl ? "refreshing" : "loading",
    }));
    lastUrlRef.current = url;

    async function load() {
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
        if (!response.ok) throw new Error(messageFromPayload(payload));
        cache.set(sessionKey, { value: payload, expiresAt: Date.now() + ttlMs });
        if (!active) return;
        initializedRef.current = true;
        setState({ data: payload as T, error: null, status: "ready" });
      } catch (loadError) {
        if (!active || controller.signal.aborted) return;
        setState((current) => ({
          ...current,
          error: messageFromError(loadError),
          status: initializedRef.current ? "error" : "error",
        }));
      }
    }

    load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [url, ttlMs, version]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);
  const setData: Dispatch<SetStateAction<T>> = useCallback((value) => {
    setState((current) => {
      const nextData = typeof value === "function" ? (value as (current: T) => T)(current.data) : value;
      return { ...current, data: nextData };
    });
  }, []);

  return {
    data: state.data,
    error: state.error,
    status: state.status,
    isInitialLoading: state.status === "loading",
    isRefreshing: state.status === "refreshing",
    reload,
    setData,
  };
}
