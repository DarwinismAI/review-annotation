import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { listTaskGroupsForAnnotator } from "@/lib/datasets/task-groups-read";
import { requireAnnotatorRead } from "@/lib/auth-middleware";

export const GET = requireAnnotatorRead(async (_req, claims, context) => {
  const payload = await context.timing.measure("sql", () => listTaskGroupsForAnnotator(db, claims.user.id));
  return NextResponse.json(payload);
});
