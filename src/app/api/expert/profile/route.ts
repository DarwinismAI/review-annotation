// @ts-nocheck
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { requireExpert } from "@/lib/auth-middleware";
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

/** GET /api/expert/profile — current expert's email + domains. */
export const GET = requireExpert(async (_req, session) => {
  const userId = session.user.id;

  const [u] = await db
    .select({ email: profiles.email, name: profiles.name, createdAt: profiles.createdAt })
    .from(profiles)
    .where(eq(profiles.id, userId));

  const domainRows = await db
    .select({ domain: expertDomains.domain })
    .from(expertDomains)
    .where(eq(expertDomains.userId, userId));

  const subDomainRows = await db
    .select({ subDomainId: expertSubDomains.subDomainId })
    .from(expertSubDomains)
    .where(eq(expertSubDomains.userId, userId));

  const medicalMicroRows = await db
    .select({ microDomainId: expertMedicalMicroDomains.microDomainId })
    .from(expertMedicalMicroDomains)
    .where(eq(expertMedicalMicroDomains.userId, userId));

  return NextResponse.json({
    data: {
      email: u?.email ?? session.user.email,
      name: u?.name ?? null,
      createdAt: u?.createdAt ?? null,
      domains: domainRows.map((r) => r.domain),
      sub_domains: subDomainRows.map((r) => r.subDomainId),
      medical_micro_domains: medicalMicroRows.map((r) => r.microDomainId),
    },
  });
});

/**
 * PUT /api/expert/profile — update domains. Validates 1-3 items, replaces atomically.
 *
 * Keeps `expert_profiles.domain` synced to the first domain so legacy admin views
 * don't break while we transition fully to expert_domains.
 */
export const PUT = requireExpert(async (req, session) => {
  let body: { domains?: unknown; sub_domains?: unknown; medical_micro_domains?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Dữ liệu không hợp lệ" } },
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
          message: "Cần giữ ít nhất 1 chuyên môn",
        },
      },
      { status: 400 }
    );
  }

  // Sub-domains optional. Drop any whose parent isn't in the new domain set.
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

  await db.delete(expertDomains).where(eq(expertDomains.userId, userId));
  await db.insert(expertDomains).values(
    domains.map((d) => ({
      id: createId(),
      userId,
      domain: d,
      createdAt: now,
    }))
  );

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

  // Sync legacy single-domain field for back-compat.
  await db
    .update(expertProfiles)
    .set({ domain: domains[0], updatedAt: now })
    .where(eq(expertProfiles.userId, userId));

  // Backfill broadcast assignments for the (possibly expanded) domain set.
  // Idempotent — safe to call on every PUT. Failure must not break profile save.
  let assigned = 0;
  try {
    assigned = await assignBroadcastForExpert(userId);
  } catch (err) {
    console.error("[profile/PUT] auto-assign failed:", err);
  }

  return NextResponse.json({
    data: {
      domains,
      sub_domains: finalSubDomains,
      medical_micro_domains: medicalMicroDomains,
      assigned,
    },
  });
});
