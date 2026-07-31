"use client";

import { useEffect } from "react";
import { setFastResourceSession } from "@/hooks/use-fast-resource";

export function FastResourceSession({
  userId,
  children,
}: {
  userId: string | null;
  children: React.ReactNode;
}) {
  setFastResourceSession(userId);

  useEffect(() => {
    setFastResourceSession(userId);
  }, [userId]);

  return <>{children}</>;
}
