import { NextRequest, NextResponse } from "next/server";
import { auth } from "./auth";

type Role = "admin" | "expert";

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
type ResolvedContext = { params: Record<string, string> };

/** Next.js 15 App Router context shape — params are a Promise. */
type RouteContext = { params: Promise<Record<string, string>> };

type Handler = (
  req: NextRequest,
  session: GuardedSession,
  context?: ResolvedContext
) => Promise<NextResponse>;

function errJson(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function getSession(req: NextRequest): Promise<GuardedSession | null> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) return null;
  return session as unknown as GuardedSession;
}

/**
 * Await Next.js 15 async params and normalise to `ResolvedContext`.
 * Next.js always passes a context object; params may be an empty object for
 * non-dynamic routes.
 */
async function resolveContext(ctx: RouteContext): Promise<ResolvedContext> {
  const params = await ctx.params;
  return { params };
}

/**
 * Wrap a route handler requiring authentication.
 * Injects the validated session so the handler doesn't need to re-fetch it.
 */
export function requireAuth(handler: Handler) {
  return async (req: NextRequest, context: RouteContext) => {
    const session = await getSession(req);
    if (!session) return errJson(401, "UNAUTHORIZED", "Chưa đăng nhập");
    return handler(req, session, await resolveContext(context));
  };
}

/**
 * Wrap a route handler requiring `admin` role.
 */
export function requireAdmin(handler: Handler) {
  return async (req: NextRequest, context: RouteContext) => {
    const session = await getSession(req);
    if (!session) return errJson(401, "UNAUTHORIZED", "Chưa đăng nhập");
    if (session.user.role !== "admin") {
      return errJson(403, "FORBIDDEN", "Chỉ admin mới có quyền thực hiện thao tác này");
    }
    return handler(req, session, await resolveContext(context));
  };
}

/**
 * Wrap a route handler requiring `expert` role.
 */
export function requireExpert(handler: Handler) {
  return async (req: NextRequest, context: RouteContext) => {
    const session = await getSession(req);
    if (!session) return errJson(401, "UNAUTHORIZED", "Chưa đăng nhập");
    if (session.user.role !== "expert") {
      return errJson(403, "FORBIDDEN", "Chỉ chuyên gia mới có quyền thực hiện thao tác này");
    }
    return handler(req, session, await resolveContext(context));
  };
}

/** Check role without wrapping — useful inside composite handlers. */
export function hasRole(session: GuardedSession, role: Role): boolean {
  return session.user.role === role;
}
