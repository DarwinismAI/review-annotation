export const APP_SERVER_TIMING_HEADER = "x-app-server-timing";

export function selectServerTimingHeader(headers: Headers): string | null {
  return headers.get("server-timing") ?? headers.get(APP_SERVER_TIMING_HEADER);
}
