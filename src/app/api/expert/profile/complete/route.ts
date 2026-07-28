// @ts-nocheck
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { requireAuth } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { expertProfiles, expertDomains, expertSubDomains, expertMedicalMicroDomains, profiles } from "@/db/schema";
import { assignBroadcastForExpert } from "@/lib/auto-assign";
import {
  isSubDomainKey,
  domainForSubDomain,
  isMedicalMicroDomainKey,
  subDomainForMedicalMicroDomain,
  DOMAIN_KEYS,
  isDomainKey,
} from "@/lib/labels";

/**
 * POST /api/expert/profile/complete
 *
 * Called from /signup/profile after OTP verification. Creates an `expert_profiles`
 * row (status=active, auto-active per PRD §3 Q1) plus 1-2 `expert_domains` rows.
 *
 * Idempotent: re-running with the same caller upserts domains rather than failing.
 */
export const POST = requireAuth(async (req, session) => {
  let body: { domains?: unknown; sub_domains?: unknown; medical_micro_domains?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Dữ liệu không hợp lệ" } },
      { status: 400 }
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 100) {
    return NextResponse.json(
      { error: { code: "INVALID_NAME", message: "Họ tên phải từ 2 đến 100 ký tự" } },
      { status: 400 }
    );
  }

  const domains = Array.isArray(body.domains)
    ? body.domains.filter(isDomainKey)
    : [];

  if (domains.length < 1 || domains.length > DOMAIN_KEYS.length) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_DOMAINS",
          message: "Vui lòng chọn ít nhất 1 chuyên môn",
        },
      },
      { status: 400 }
    );
  }

  // Sub-domains optional. Only accept IDs whose parent is in the selected domain set.
  // Empty / missing → "any sub-domain of selected domains" (no narrowing).
  const domainSet = new Set(domains);
  const subDomains = Array.isArray(body.sub_domains)
    ? Array.from(
        new Set(
          body.sub_domains.filter(
            (s): s is string =>
              isSubDomainKey(s) && domainSet.has(domainForSubDomain(s) ?? "")
          )
        )
      )
    : [];
  const subDomainSet = new Set(subDomains);
  const medicalMicroDomains = Array.isArray(body.medical_micro_domains)
    ? Array.from(
        new Set(
          body.medical_micro_domains.filter((microId): microId is string => {
            if (!domainSet.has("medical") || !isMedicalMicroDomainKey(microId)) return false;
            const parent = subDomainForMedicalMicroDomain(microId);
            if (parent) subDomainSet.add(parent);
            return parent != null;
          })
        )
      )
    : [];
  const finalSubDomains = Array.from(subDomainSet);

  const userId = session.user.id;
  const now = Date.now();
  const primary = domains[0];

  // 1. Update profiles.name (auth.users + profiles row created by DB trigger
  //    on signup; we set the human-readable name here).
  await db
    .update(profiles)
    .set({ name, updatedAt: new Date() })
    .where(eq(profiles.id, userId));

  // 2. Upsert expert_profiles primary row (back-compat — single domain field).
  const [existingProfile] = await db
    .select({ id: expertProfiles.id })
    .from(expertProfiles)
    .where(eq(expertProfiles.userId, userId));

  if (existingProfile) {
    await db
      .update(expertProfiles)
      .set({
        domain: primary,
        status: "active",
        activatedAt: now,
        updatedAt: now,
      })
      .where(eq(expertProfiles.userId, userId));
  } else {
    await db.insert(expertProfiles).values({
      id: createId(),
      userId,
      domain: primary,
      status: "active",
      invitedAt: now,
      activatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  // 3. Reset expert_domains to exactly the requested set.
  await db.delete(expertDomains).where(eq(expertDomains.userId, userId));
  await db.insert(expertDomains).values(
    domains.map((d) => ({
      id: createId(),
      userId,
      domain: d,
      createdAt: now,
    }))
  );

  // 3b. Reset expert_sub_domains to exactly the requested set (empty allowed).
  await db.delete(expertSubDomains).where(eq(expertSubDomains.userId, userId));
  if (finalSubDomains.length > 0) {
    await db.insert(expertSubDomains).values(
      finalSubDomains.map((subId) => ({
        id: createId(),
        userId,
        subDomainId: subId,
        createdAt: now,
      }))
    );
  }

  // 3c. Reset medical micro-domain preferences (empty allowed).
  await db.delete(expertMedicalMicroDomains).where(eq(expertMedicalMicroDomains.userId, userId));
  if (medicalMicroDomains.length > 0) {
    await db.insert(expertMedicalMicroDomains).values(
      medicalMicroDomains.map((microId) => ({
        id: createId(),
        userId,
        microDomainId: microId,
        createdAt: now,
      }))
    );
  }

  // 4. Auto-assign all matching broadcast articles to this expert (multi-reviewer).
  //    Failure here must not break signup — log + continue.
  let assigned = 0;
  try {
    assigned = await assignBroadcastForExpert(userId);
  } catch (err) {
    console.error("[profile/complete] auto-assign failed:", err);
  }

  return NextResponse.json({
    data: {
      activated: true,
      domains,
      sub_domains: finalSubDomains,
      medical_micro_domains: medicalMicroDomains,
      assigned,
    },
  });
});
