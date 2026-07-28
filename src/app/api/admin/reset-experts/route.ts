/**
 * TEMPORARY ops endpoint — wipes all expert accounts so the system can rehydrate
 * from fresh account setup. Used once after the sub-domain schema change (migrations
 * 0010 + 0011) so existing reviewer data doesn't pollute the new taxonomy.
 *
 * Mechanism: delete from auth.users WHERE id maps to a public.profiles row with
 * role='expert'. The auth.users → profiles FK is `ON DELETE CASCADE`, and every
 * downstream expert table (expert_profiles, expert_domains, expert_sub_domains,
 * assignments, article_comments, claim_ratings, article_review_session) cascades
 * from profiles. One DELETE wipes the lot.
 *
 * Article state is denormalised (`articles.status`), so we explicitly reset every
 * article to 'unassigned' afterwards — otherwise rows left at 'assigned' or
 * 'completed' point at deleted assignments and become unreviewable.
 *
 * DELETE THIS FILE after the one-shot run.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const POST = requireAdmin(async () => {
  try {
    const deleted = await db.execute(sql`
      DELETE FROM auth.users
      WHERE id IN (SELECT id FROM public.profiles WHERE role = 'expert')
    `);

    const reset = await db.execute(sql`
      UPDATE public.articles SET status = 'unassigned'
      WHERE status <> 'unassigned'
    `);

    return NextResponse.json({
      ok: true,
      deletedExperts: deleted?.rowCount ?? 0,
      resetArticles: reset?.rowCount ?? 0,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
});
