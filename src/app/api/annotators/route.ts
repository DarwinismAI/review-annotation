// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-middleware";
import { db } from "@/db/client";
import { expertProfiles, expertDomains, expertSubDomains, expertMedicalMicroDomains, profiles } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";

/** GET /api/annotators - list annotators (admin only). */
export const GET = requireAdmin(async (req) => {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const domain = searchParams.get("domain");

  const conditions = [];
  if (status) conditions.push(eq(expertProfiles.status, status));
  if (domain) conditions.push(eq(expertProfiles.domain, domain));

  const rows = await db
    .select({
      id: expertProfiles.id,
      email: profiles.email,
      name: profiles.name,
      domain: expertProfiles.domain,
      status: expertProfiles.status,
      invitedAt: expertProfiles.invitedAt,
      activatedAt: expertProfiles.activatedAt,
      userId: profiles.id,
    })
    .from(expertProfiles)
    .innerJoin(profiles, eq(expertProfiles.userId, profiles.id))
    .where(conditions.length ? and(...conditions) : undefined);

  // Two batched lookups instead of N+1 - keeps the list responsive even with many annotators.
  const userIds = rows.map((r) => r.userId);
  const domainsByUser = new Map<string, string[]>();
  const subDomainsByUser = new Map<string, string[]>();
  const medicalMicroDomainsByUser = new Map<string, string[]>();

  if (userIds.length > 0) {
    const domainRows = await db
      .select({ userId: expertDomains.userId, domain: expertDomains.domain })
      .from(expertDomains)
      .where(inArray(expertDomains.userId, userIds));
    for (const r of domainRows) {
      const list = domainsByUser.get(r.userId) ?? [];
      list.push(r.domain);
      domainsByUser.set(r.userId, list);
    }

    const subRows = await db
      .select({ userId: expertSubDomains.userId, subDomainId: expertSubDomains.subDomainId })
      .from(expertSubDomains)
      .where(inArray(expertSubDomains.userId, userIds));
    for (const r of subRows) {
      const list = subDomainsByUser.get(r.userId) ?? [];
      list.push(r.subDomainId);
      subDomainsByUser.set(r.userId, list);
    }

    const medicalMicroRows = await db
      .select({
        userId: expertMedicalMicroDomains.userId,
        microDomainId: expertMedicalMicroDomains.microDomainId,
      })
      .from(expertMedicalMicroDomains)
      .where(inArray(expertMedicalMicroDomains.userId, userIds));
    for (const r of medicalMicroRows) {
      const list = medicalMicroDomainsByUser.get(r.userId) ?? [];
      list.push(r.microDomainId);
      medicalMicroDomainsByUser.set(r.userId, list);
    }
  }

  const data = rows.map((r) => ({
    ...r,
    domains: domainsByUser.get(r.userId) ?? (r.domain ? [r.domain] : []),
    sub_domains: subDomainsByUser.get(r.userId) ?? [],
    medical_micro_domains: medicalMicroDomainsByUser.get(r.userId) ?? [],
  }));

  return NextResponse.json({ data });
});
