"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CommitAnalyzeButton({ commitId }: { commitId: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const analyze = async () => {
    setRunning(true);
    setMessage(null);
    setIsError(false);
    try {
      const response = await fetch(`/api/commits/${commitId}/analyze`, { method: "POST" });
      const payload = (await response.json()) as {
        success: boolean;
        error?: string | null;
        data?: { analyzedBy?: string; candidateId?: number | null };
      };
      if (!response.ok || !payload.success) {
        setIsError(true);
        setMessage(payload.error ?? "分析失败");
        return;
      }
      const engine = payload.data?.analyzedBy === "heuristic+claude" ? "启发式 + Claude" : "启发式";
      setMessage(
        payload.data?.candidateId
          ? `已重新分析（${engine}），并生成候选 #${payload.data.candidateId}`
          : `已重新分析（${engine}）`,
      );
      router.refresh();
    } catch {
      setIsError(true);
      setMessage("网络错误，分析失败");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" className="btn" onClick={analyze} disabled={running}>
        <Sparkles size={13} />
        {running ? "分析中…" : "重新分析"}
      </button>
      {message ? (
        <span className={`text-[11px] ${isError ? "text-danger" : "text-muted"}`}>{message}</span>
      ) : null}
    </div>
  );
}
