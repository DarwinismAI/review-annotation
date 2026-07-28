/**
 * App auth surface - Supabase Auth (path A iter-3).
 *
 * Backwards-compat shim: existing API routes import `auth.api.getSession({ headers })`
 * (legacy better-auth shape). We re-export the Supabase helpers and provide a tiny
 * `auth.api` adapter so route handlers can migrate one-by-one.
 */
import { getSession, requireSession, requireRole, getSupabaseServer, getSupabaseAdmin } from "@/lib/supabase/server";
export type { AppRole, AppSession } from "@/lib/supabase/server";

export { getSession, requireSession, requireRole, getSupabaseServer, getSupabaseAdmin };

/**
 * Legacy adapter - `auth.api.getSession({ headers })` used to return
 * `{ user: { id, email, role } } | null`. We now ignore the headers arg
 * (Next 15 cookies() reads the request automatically) and synthesize the
 * same shape from the Supabase session.
 */
export const auth = {
  api: {
    async getSession(_opts?: { headers?: Headers }) {
      const session = await getSession();
      if (!session) return null;
      return { user: { id: session.userId, email: session.email, role: session.role } };
    },
  },
};
