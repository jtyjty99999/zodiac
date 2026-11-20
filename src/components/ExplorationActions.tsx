"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface DeletePayload {
  success: boolean;
  error?: string | null;
}

export default function ExplorationActions({ explorationId }: { explorationId: number }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (deleting) return;
    const confirmed = window.confirm("确定删除这条探索记录？删除后不可恢复。");
    if (!confirmed) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/explorations/${explorationId}`, { method: "DELETE" });
      const payload = (await response.json()) as DeletePayload;
      if (!response.ok || !payload.success) {
        setError(payload.error ?? "删除失败");
        return;
      }
      router.push("/explore");
      router.refresh();
    } catch {
      setError("网络错误，删除失败");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="btn px-2 py-1 text-[11px] text-danger"
        onClick={remove}
        disabled={deleting}
        aria-label="删除探索"
      >
        <Trash2 size={12} />
        {deleting ? "删除中…" : "删除"}
      </button>
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </div>
  );
}
