import { NextResponse } from "next/server";
import { isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { articles } from "@/db/schema";
import {
  DOMAIN_TO_SUB_DOMAINS,
  DOMAIN_KEYS,
  domainForSubDomain,
  isSubDomainKey,
  type DomainKey,
  type SubDomainKey,
} from "@/lib/labels";
import { getSession } from "@/lib/supabase/server";

type AvailableMap = Record<DomainKey, SubDomainKey[]>;

// In-memory cache shared across requests on the same Vercel instance.
// 60s TTL is enough: admin imports tolerate a 1-minute lag for the picker
// to surface newly-seeded sub-domains. Resets on cold start.
let cache: { value: AvailableMap; expiresAt: number } | null = null;
const TTL_MS = 60_000;

function emptyMap(): AvailableMap {
  const result = {} as AvailableMap;
  for (const domain of DOMAIN_KEYS) {
    result[domain] = [];
  }
  return result;
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (cache && cache.expiresAt > Date.now()) {
    return NextResponse.json({ data: cache.value });
  }

  const rows = await db
    .selectDistinct({ subDomainId: articles.subDomainId })
    .from(articles)
    .where(isNotNull(articles.subDomainId));

  const grouped = emptyMap();
  for (const row of rows) {
    const sub = row.subDomainId;
    if (!sub || !isSubDomainKey(sub)) continue;
    const parent = domainForSubDomain(sub);
    if (!parent) continue;
    grouped[parent].push(sub);
  }

  for (const d of Object.keys(grouped) as DomainKey[]) {
    const order = DOMAIN_TO_SUB_DOMAINS[d];
    grouped[d].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }

  cache = { value: grouped, expiresAt: Date.now() + TTL_MS };
  return NextResponse.json({ data: grouped });
}
