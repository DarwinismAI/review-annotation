import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { requireAnnotator } from "@/lib/auth-middleware";
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
 * POST /api/annotator/profile/complete
 *
 * Completes a pending expert invitation created by an administrator.
 *
 * Idempotent: re-running with the same caller upserts domains rather than failing.
 */
export const POST = requireAnnotator(async (req, session) => {
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
            (subDomain): subDomain is string => {
              if (!isSubDomainKey(subDomain)) return false;
              const parentDomain = domainForSubDomain(subDomain);
              return parentDomain !== null && domainSet.has(parentDomain);
            }
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

  const [existingProfile] = await db
    .select({ id: expertProfiles.id, status: expertProfiles.status })
    .from(expertProfiles)
    .where(eq(expertProfiles.userId, userId));

  if (!existingProfile) {
    return NextResponse.json(
      {
        error: {
          code: "INVITATION_REQUIRED",
          message: "Tài khoản chưa được quản trị viên mời",
        },
      },
      { status: 403 }
    );
  }

  if (existingProfile.status === "inactive") {
    return NextResponse.json(
      {
        error: {
          code: "PROFILE_INACTIVE",
          message: "Tài khoản annotator đã bị vô hiệu hóa",
        },
      },
      { status: 403 }
    );
  }

  // 1. Update the human-readable name mirrored from the auth account.
  await db
    .update(profiles)
    .set({ name, updatedAt: new Date() })
    .where(eq(profiles.id, userId));

  // 2. Activate the admin-created expert profile; this route never creates invitations.
  await db
    .update(expertProfiles)
    .set({
      domain: primary,
      status: "active",
      activatedAt: now,
      updatedAt: now,
    })
    .where(eq(expertProfiles.userId, userId));

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
  //    Failure here must not break signup - log + continue.
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
