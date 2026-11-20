"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const POLL_INTERVAL_MS = 2_000;
const ERROR_RETRY_MS = 5_000;

interface AnalyzePayload {
  success: boolean;
  data?: { analyzing?: boolean; status?: string; analyzedBy?: string | null };
  error?: string | null;
}

/**
 * Starts a background re-analysis and polls until it lands. The server tracks
 * the running state per commit, so a page refresh mid-analysis keeps showing
 * 「分析中…」 and the button re-attaches to the same run.
 */
export default function CommitAnalyzeButton({
  commitId,
  initialAnalyzing = false,
}: {
  commitId: number;
  initialAnalyzing?: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(initialAnalyzing);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

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
        const response = await fetch(`/api/commits/${commitId}/analyze`, { cache: "no-store" });
        const payload = (await response.json()) as AnalyzePayload;
        if (!response.ok || !payload.success) {
          setIsError(true);
          setMessage(payload.error ?? "无法获取分析状态");
          schedule(ERROR_RETRY_MS);
          return;
        }
        if (payload.data?.analyzing) {
          schedule(POLL_INTERVAL_MS);
          return;
        }
        setRunning(false);
        setIsError(false);
        setMessage("已完成重新分析");
        router.refresh();
      } catch {
        setIsError(true);
        setMessage("网络错误，正在重试…");
        schedule(ERROR_RETRY_MS);
      }
    }

    schedule(POLL_INTERVAL_MS);

    return () => {
      stopped.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [running, commitId, router]);

  const analyze = async () => {
    setRunning(true);
    setMessage(null);
    setIsError(false);
    try {
      const response = await fetch(`/api/commits/${commitId}/analyze`, { method: "POST" });
      const payload = (await response.json()) as AnalyzePayload;
      if (!response.ok || !payload.success) {
        setRunning(false);
        setIsError(true);
        setMessage(payload.error ?? "分析失败");
      }
    } catch {
      setRunning(false);
      setIsError(true);
      setMessage("网络错误，请稍后重试");
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" className="btn" onClick={analyze} disabled={running}>
        {running ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
        {running ? "分析中…" : "重新分析"}
      </button>
      {running ? (
        <span className="text-[11px] text-muted">
          正在读取提交与 diff，通常需要几十秒；可以刷新页面，进度会继续。
        </span>
      ) : null}
      {message ? (
        <span className={`text-[11px] ${isError ? "text-danger" : "text-muted"}`}>{message}</span>
      ) : null}
    </div>
  );
}
