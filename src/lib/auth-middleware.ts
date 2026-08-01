import { NextRequest, NextResponse } from "next/server";
import { getSession as getAppSession } from "./auth";
import { createRequestTiming, type RequestTiming } from "@/lib/request-timing";
import { isAdminRole, isAnnotatorRole, isSuperAdminRole, type AppRole } from "@/lib/roles";

interface SessionUser {
  id: string;
  email: string;
  name: string | null | undefined;
  role: string;
}

interface GuardedSession {
  user: SessionUser;
}

/** Resolved params after awaiting the Next.js 15 async params Promise. */
type ResolvedContext = { params: Record<string, string>; timing: RequestTiming };

/** Next.js 15 App Router context shape - params are a Promise. */
type RouteContext = { params: Promise<Record<string, string>> };

type Handler = (
  req: NextRequest,
  session: GuardedSession,
  context: ResolvedContext
) => Promise<NextResponse>;

function withTiming(response: NextResponse, timing: RequestTiming) {
  const header = timing.header();
  response.headers.set("Server-Timing", header);
  response.headers.set("X-App-Server-Timing", header);
  return response;
}

function errJson(status: number, code: string, message: string, timing: RequestTiming) {
  return withTiming(NextResponse.json({ error: { code, message } }, { status }), timing);
}

async function getSession(timing: RequestTiming): Promise<GuardedSession | null> {
  const session = await getAppSession(timing);
  if (!session) return null;
  return { user: { id: session.userId, email: session.email, name: session.name, role: session.role } };
}

/**
 * Await Next.js 15 async params and normalise to `ResolvedContext`.
 * Next.js always passes a context object; params may be an empty object for
 * non-dynamic routes.
 */
async function resolveContext(ctx: RouteContext | undefined, timing: RequestTiming): Promise<ResolvedContext> {
  if (!ctx?.params) return { params: {}, timing };
  const params = await ctx.params;
  return { params, timing };
}

/**
 * Wrap a route handler requiring authentication.
 * Injects the validated session so the handler doesn't need to re-fetch it.
 */
export function requireAuth(handler: Handler) {
  return async (req: NextRequest, context: RouteContext) => {
    const timing = createRequestTiming();
    const session = await getSession(timing);
    if (!session) return errJson(401, "UNAUTHORIZED", "Chưa đăng nhập", timing);
    return withTiming(await handler(req, session, await resolveContext(context, timing)), timing);
  };
}

/**
 * Wrap a route handler requiring `admin` role.
 */
export function requireAdmin(handler: Handler) {
  return async (req: NextRequest, context: RouteContext) => {
    const timing = createRequestTiming();
    const session = await getSession(timing);
    if (!session) return errJson(401, "UNAUTHORIZED", "Chưa đăng nhập", timing);
    if (!isAdminRole(session.user.role)) {
      return errJson(403, "FORBIDDEN", "Chỉ admin mới có quyền thực hiện thao tác này", timing);
    }
    return withTiming(await handler(req, session, await resolveContext(context, timing)), timing);
  };
}

/**
 * Wrap a route handler requiring `superadmin` role.
 */
export function requireSuperAdmin(handler: Handler) {
  return async (req: NextRequest, context: RouteContext) => {
    const timing = createRequestTiming();
    const session = await getSession(timing);
    if (!session) return errJson(401, "UNAUTHORIZED", "Chưa đăng nhập", timing);
    if (!isSuperAdminRole(session.user.role)) {
      return errJson(403, "FORBIDDEN", "Chỉ superadmin mới có quyền thực hiện thao tác này", timing);
    }
    return withTiming(await handler(req, session, await resolveContext(context, timing)), timing);
  };
}

/**
 * Wrap a route handler requiring `annotator` role.
 */
export function requireAnnotator(handler: Handler) {
  return async (req: NextRequest, context: RouteContext) => {
    const timing = createRequestTiming();
    const session = await getSession(timing);
    if (!session) return errJson(401, "UNAUTHORIZED", "Chưa đăng nhập", timing);
    if (!isAnnotatorRole(session.user.role)) {
      return errJson(403, "FORBIDDEN", "Chỉ annotator mới có quyền thực hiện thao tác này", timing);
    }
    return withTiming(await handler(req, session, await resolveContext(context, timing)), timing);
  };
}

/** Check role without wrapping - useful inside composite handlers. */
export function hasRole(session: GuardedSession, role: AppRole): boolean {
  if (role === "admin") return isAdminRole(session.user.role);
  return session.user.role === role;
}
