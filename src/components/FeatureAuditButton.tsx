"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FeatureAuditStatus } from "@/lib/types";

const POLL_INTERVAL_MS = 2_000;
const ERROR_RETRY_MS = 5_000;

interface AuditPayload {
  success: boolean;
  data?: {
    audit?: { status: FeatureAuditStatus; error?: string | null } | null;
  };
  error?: string | null;
}

/**
 * Starts an AI re-audit of one feature and polls until it finishes. The audit
 * writes the catalog directly, so the page refreshes when it lands.
 */
export default function FeatureAuditButton({
  featureKey,
  featureName,
  initialRunning = false,
}: {
  featureKey: string;
  featureName: string;
  initialRunning?: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(initialRunning);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!running) return;
    const stopped = { current: false };
    let timer: ReturnType<typeof setTimeout> | null = null;

    function schedule(delayMs: number) {
      if (stopped.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void tick();
      }, delayMs);
    }

    async function tick() {
      if (stopped.current) return;
      try {
        const response = await fetch(`/api/feature-audits/${encodeURIComponent(featureKey)}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as AuditPayload;
        const audit = payload.data?.audit;
        if (!response.ok || !payload.success || !audit) {
          setError(payload.error ?? "无法获取重审状态");
          schedule(ERROR_RETRY_MS);
          return;
        }
        if (audit.status === "running") {
          schedule(POLL_INTERVAL_MS);
          return;
        }
        setRunning(false);
        if (audit.status === "failed") {
          setError(audit.error ?? "AI 重审失败");
        }
        router.refresh();
      } catch {
        setError("网络错误，正在重试…");
        schedule(ERROR_RETRY_MS);
      }
    }

    schedule(POLL_INTERVAL_MS);

    return () => {
      stopped.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [running, featureKey, router]);

  async function start() {
    const confirmed = window.confirm(
      `AI 重审将用模型读取所有 harness 的代码快照，并直接覆盖「${featureName}」的支持状态、实现细节与横向总结，同时生成一个可回滚的基线版本。继续？`,
    );
    if (!confirmed) return;

    setError(null);
    try {
      const response = await fetch(`/api/feature-audits/${encodeURIComponent(featureKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const payload = (await response.json()) as AuditPayload;
      if (!response.ok || !payload.success) {
        setError(payload.error ?? "重审请求失败");
        return;
      }
      setRunning(true);
    } catch {
      setError("网络错误，请稍后重试");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-primary" onClick={start} disabled={running}>
        {running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {running ? "AI 重审中…" : "AI 重审功能点"}
      </button>
      {running ? (
        <span className="text-[11px] text-muted">
          正在读取各 harness 代码快照并生成对比，通常需要 1–3 分钟。
        </span>
      ) : null}
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </div>
  );
}
