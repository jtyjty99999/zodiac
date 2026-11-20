"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ExplorationPhase, ExplorationStatus } from "@/lib/types";

const POLL_INTERVAL_MS = 2000;
const ERROR_RETRY_MS = 4000;

interface StatusPayload {
  success: boolean;
  data?: {
    exploration?: {
      status: ExplorationStatus;
      phase: ExplorationPhase;
    };
  };
}

export default function ExplorationLive({
  explorationId,
  initialPhase,
}: {
  explorationId: number;
  initialPhase: ExplorationPhase;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<ExplorationPhase>(initialPhase);
  const stopped = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // StrictMode remounts in dev; reset the flag so polling can continue.
    stopped.current = false;

    function schedule(delayMs: number) {
      if (stopped.current) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void tick();
      }, delayMs);
    }

    async function tick() {
      if (stopped.current) return;
      try {
        const response = await fetch(`/api/explorations/${explorationId}`, { cache: "no-store" });
        const payload = (await response.json()) as StatusPayload;
        const current = payload.data?.exploration;
        if (!response.ok || !payload.success || !current) {
          schedule(ERROR_RETRY_MS);
          return;
        }
        if (current.status === "running") {
          setPhase(current.phase);
          schedule(POLL_INTERVAL_MS);
          return;
        }
        router.refresh();
      } catch {
        schedule(ERROR_RETRY_MS);
      }
    }

    schedule(POLL_INTERVAL_MS);

    return () => {
      stopped.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [explorationId, router]);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-accent">
      <Loader2 size={13} className="animate-spin" />
      {phase === "explore"
        ? "AI 正在阅读代码并收集证据，可能需要一两分钟…"
        : phase === "synthesize"
          ? "正在综合分析各 harness 的证据…"
          : "正在离线检索各 harness 的本地镜像…"}
    </div>
  );
}
