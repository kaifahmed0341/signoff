"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refreshes server data while something is running, such as the checker. */
export function AutoRefresh({ active, everyMs = 2500 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}
