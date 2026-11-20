"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Marks the current feature as a deep dive (or removes the badge). The content
 * itself is written by AI re-audit or the seed baseline; this only toggles the
 * catalog flag and records a dated baseline version.
 */
export default function FeatureDeepDiveToggle({
  featureId,
  deepDive,
}: {
  featureId: number;
  deepDive: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/features/${featureId}/deep-dive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deepDive: !deepDive }),
      });
      const payload = (await response.json()) as { success: boolean; error?: string | null };
      if (!response.ok || !payload.success) {
        setError(payload.error ?? "操作失败");
        return;
      }
      router.refresh();
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="btn" onClick={toggle} disabled={pending}>
        {pending ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
        {deepDive ? "取消深挖" : "设为深挖"}
      </button>
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </span>
  );
}
