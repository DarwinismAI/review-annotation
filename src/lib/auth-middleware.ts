import { NextRequest, NextResponse } from "next/server";
import { getSession as getAppSession } from "./auth";
import { getSessionFromClaims, getVerifiedSessionClaims, type VerifiedSessionClaims } from "@/lib/supabase/server";
import { createRequestTiming, type RequestTiming } from "@/lib/request-timing";
import { runAuthorizedRead } from "@/lib/read-auth-flow";
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

type ReadOnlyRequest = Omit<NextRequest, "arrayBuffer" | "blob" | "formData" | "json" | "text"> & {
  readonly method: string;
};

type Handler = (
  req: NextRequest,
  session: GuardedSession,
  context: ResolvedContext
) => Promise<NextResponse>;

type ReadClaimsSession = {
  user: Pick<SessionUser, "id" | "email">;
};

type ReadContext = ResolvedContext & { session: Promise<GuardedSession> };

type ReadHandler = (
  req: ReadOnlyRequest,
  claims: ReadClaimsSession,
  context: ReadContext
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

async function getSessionFromVerifiedClaims(
  claims: VerifiedSessionClaims,
  timing: RequestTiming,
): Promise<GuardedSession | null> {
  const session = await getSessionFromClaims(claims, timing);
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

function requireRead(handler: ReadHandler, isAllowed: (session: GuardedSession) => boolean, forbiddenMessage: string) {
  return async (req: NextRequest, context: RouteContext) => {
    const timing = createRequestTiming();
    if (req.method !== "GET") return errJson(405, "METHOD_NOT_ALLOWED", "Chỉ hỗ trợ GET", timing);

    const result = await runAuthorizedRead({
      getClaims: () => getVerifiedSessionClaims(timing),
      getProfile: (claims) => getSessionFromVerifiedClaims(claims, timing),
      startHandler: async (claims, session) => {
        const resolvedContext = await resolveContext(context, timing);
        return handler(
          req as ReadOnlyRequest,
          { user: { id: claims.userId, email: claims.email } },
          { ...resolvedContext, session },
        );
      },
      isAllowed,
    });

    if (result.status === "unauthorized") return errJson(401, "UNAUTHORIZED", "Chưa đăng nhập", timing);
    if (result.status === "forbidden") return errJson(403, "FORBIDDEN", forbiddenMessage, timing);
    return withTiming(result.response, timing);
  };
}

export function requireAdminRead(handler: ReadHandler) {
  return requireRead(handler, (session) => isAdminRole(session.user.role), "Chỉ admin mới có quyền thực hiện thao tác này");
}

export function requireAnnotatorRead(handler: ReadHandler) {
  return requireRead(handler, (session) => isAnnotatorRole(session.user.role), "Chỉ annotator mới có quyền thực hiện thao tác này");
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
