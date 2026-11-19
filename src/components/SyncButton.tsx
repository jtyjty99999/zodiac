"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface SyncButtonProps {
  harnessId?: number;
  all?: boolean;
  label?: string;
  compact?: boolean;
}

type Phase = "idle" | "running" | "done" | "error";

interface StatusHarness {
  id: number;
  lastError: string | null;
}

interface StatusPayload {
  success: boolean;
  data?: { running: Array<{ harnessId: number }>; harnesses?: StatusHarness[] };
}

export default function SyncButton({ harnessId, all, label, compact }: SyncButtonProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    return () => {
      stopped.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const poll = () => {
    const tick = async () => {
      if (stopped.current) return;
      try {
        const response = await fetch("/api/sync/status", { cache: "no-store" });
        const payload = (await response.json()) as StatusPayload;
        const running = payload.data?.running ?? [];
        const stillMine = harnessId
          ? running.some((run) => run.harnessId === harnessId)
          : running.length > 0;
        if (!stillMine) {
          const harnesses = payload.data?.harnesses ?? [];
          const failure = harnessId
            ? harnesses.find((entry) => entry.id === harnessId)?.lastError
            : (harnesses.find((entry) => entry.lastError)?.lastError ?? null);
          if (failure) {
            setPhase("error");
            setMessage(`同步失败：${failure.slice(0, 160)}`);
          } else {
            setPhase("done");
            setMessage("同步完成");
            router.refresh();
            timer.current = setTimeout(() => setPhase("idle"), 2500);
          }
          return;
        }
        timer.current = setTimeout(tick, 2500);
      } catch {
        timer.current = setTimeout(tick, 4000);
      }
    };
    timer.current = setTimeout(tick, 1200);
  };

  const start = async () => {
    setPhase("running");
    setMessage(null);
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(harnessId ? { harnessId } : { all: true }),
      });
      const payload = (await response.json()) as { success: boolean; error?: string | null };
      if (!response.ok || !payload.success) {
        setPhase("error");
        setMessage(payload.error ?? "同步启动失败");
        return;
      }
      setMessage(all ? "已启动全部 harness 同步" : "已启动同步");
      poll();
    } catch {
      setPhase("error");
      setMessage("网络错误，无法启动同步");
    }
  };

  const text =
    phase === "running"
      ? "同步中…"
      : phase === "done"
        ? "已完成"
        : phase === "error"
          ? "重试"
          : (label ?? (all ? "立即跟进全部" : "立即跟进"));

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        className={`btn ${compact ? "px-2 py-1 text-[11px]" : "btn-primary"}`}
        onClick={start}
        disabled={phase === "running"}
        title={message ?? undefined}
      >
        <RefreshCw size={compact ? 11 : 13} className={phase === "running" ? "animate-spin" : ""} />
        {text}
      </button>
      {message && phase === "error" ? (
        <span className="text-[11px] text-danger">{message}</span>
      ) : null}
    </div>
  );
}
