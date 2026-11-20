"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface SyncButtonProps {
  harnessId?: number;
  all?: boolean;
  label?: string;
  compact?: boolean;
  /** Runs the server currently considers active (lets a refresh resume polling). */
  initialRunIds?: number[];
}

type Phase = "idle" | "running" | "done" | "error";

interface RunSummary {
  id: number;
  harnessId: number;
  status: "running" | "success" | "failed";
  phase: string;
  newCommits: number;
  newReleases: number;
  error: string | null;
}

interface StartedRun {
  harnessId: number;
  slug: string;
  runId: number | null;
}

interface StartPayload {
  success: boolean;
  error?: string | null;
  data?: { started?: StartedRun[]; alreadyRunning?: StartedRun[] };
}

interface StatusPayload {
  success: boolean;
  error?: string | null;
  data?: { runs?: RunSummary[]; running?: Array<{ harnessId: number }> };
}

const POLL_INTERVAL_MS = 2000;
const ERROR_RETRY_MS = 4000;
const DONE_RESET_MS = 2500;

export default function SyncButton({
  harnessId,
  all,
  label,
  compact,
  initialRunIds,
}: SyncButtonProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(
    initialRunIds && initialRunIds.length > 0 ? "running" : "idle",
  );
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);
  const runIds = useRef<number[]>(initialRunIds ?? []);
  const sawRunning = useRef(false);

  const schedule = (ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void tick();
    }, ms);
  };

  const complete = (runs: RunSummary[]) => {
    const failed = runs.find((run) => run.status === "failed");
    if (failed) {
      setPhase("error");
      setMessage(`同步失败：${(failed.error ?? "未知错误").slice(0, 160)}`);
      return;
    }
    const added = runs.reduce((sum, run) => sum + run.newCommits, 0);
    setPhase("done");
    setMessage(added > 0 ? `同步完成，新增 ${added} 个提交` : "同步完成");
    router.refresh();
    timer.current = setTimeout(() => {
      setPhase("idle");
      runIds.current = [];
    }, DONE_RESET_MS);
  };

  const tick = async () => {
    if (stopped.current) return;
    const ids = runIds.current;
    try {
      const url = ids.length > 0 ? `/api/sync/status?runIds=${ids.join(",")}` : "/api/sync/status";
      const response = await fetch(url, { cache: "no-store" });
      const payload = (await response.json()) as StatusPayload;
      if (!response.ok || !payload.success) {
        schedule(ERROR_RETRY_MS);
        return;
      }

      if (ids.length > 0) {
        const runs = payload.data?.runs ?? [];
        const active = runs.filter((run) => run.status === "running");
        if (active.length > 0) {
          if (!sawRunning.current) {
            sawRunning.current = true;
            setPhase("running");
          }
          schedule(POLL_INTERVAL_MS);
          return;
        }
        if (!sawRunning.current) {
          // The server-rendered run finished before we observed it running.
          // Don't claim a fresh completion the user did not just trigger.
          setPhase("idle");
          setMessage(null);
          runIds.current = [];
          router.refresh();
          return;
        }
        complete(runs);
        return;
      }

      // Fallback for responses without run ids: infer from the running list.
      const running = payload.data?.running ?? [];
      const stillMine = harnessId
        ? running.some((run) => run.harnessId === harnessId)
        : running.length > 0;
      if (stillMine) {
        sawRunning.current = true;
        setPhase("running");
        schedule(POLL_INTERVAL_MS);
        return;
      }
      setPhase("done");
      setMessage("同步完成");
      router.refresh();
      timer.current = setTimeout(() => setPhase("idle"), DONE_RESET_MS);
    } catch {
      schedule(ERROR_RETRY_MS);
    }
  };

  // Resume polling after a page refresh when the server already had a run
  // active for this button.
  // biome-ignore lint/correctness/useExhaustiveDependencies: start once on mount; tick only reads refs, so re-running on render would restart polling.
  useEffect(() => {
    if (runIds.current.length === 0) return;
    setPhase("running");
    timer.current = setTimeout(() => {
      void tick();
    }, 400);
  }, []);

  useEffect(() => {
    // StrictMode mounts, cleans up and remounts in dev; reset the flag so the
    // remounted instance can still poll.
    stopped.current = false;
    return () => {
      stopped.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const start = async () => {
    setPhase("running");
    setMessage(null);
    sawRunning.current = false;
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(harnessId ? { harnessId } : { all: true }),
      });
      const payload = (await response.json()) as StartPayload;
      if (!response.ok || !payload.success) {
        setPhase("error");
        setMessage(payload.error ?? "同步启动失败");
        return;
      }

      const started = payload.data?.started ?? [];
      const already = payload.data?.alreadyRunning ?? [];
      const ids = [...started, ...already]
        .map((entry) => entry.runId)
        .filter((id): id is number => typeof id === "number");
      runIds.current = ids;

      if (started.length === 0) {
        setMessage("已有同步正在进行");
      } else {
        setMessage(all ? "已启动全部 harness 同步" : "已启动同步");
      }
      sawRunning.current = ids.length > 0;
      schedule(ids.length > 0 ? 800 : 1200);
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
