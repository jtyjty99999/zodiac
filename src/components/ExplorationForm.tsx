"use client";

import { Compass } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface HarnessOption {
  id: number;
  name: string;
  enabled: boolean;
}

interface StartPayload {
  success: boolean;
  error?: string | null;
  data?: { id?: number };
}

const MIN_PROPOSITION_LENGTH = 5;
const MAX_PROPOSITION_LENGTH = 600;

export default function ExplorationForm({ harnesses }: { harnesses: HarnessOption[] }) {
  const router = useRouter();
  const [proposition, setProposition] = useState("");
  const [selected, setSelected] = useState<number[]>(
    harnesses.filter((harness) => harness.enabled).map((harness) => harness.id),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = proposition.trim();
  const tooShort = trimmed.length < MIN_PROPOSITION_LENGTH;
  const disabled = submitting || tooShort || selected.length === 0;

  const toggle = (id: number) => {
    setSelected((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    );
  };

  const submit = async () => {
    if (disabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/explorations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposition: trimmed, harnessIds: selected }),
      });
      const payload = (await response.json()) as StartPayload;
      if (!response.ok || !payload.success || !payload.data?.id) {
        setError(payload.error ?? "探索提交失败");
        return;
      }
      router.push(`/explore/${payload.data.id}`);
    } catch {
      setError("网络错误，无法提交探索");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="label mb-1.5 block" htmlFor="exploration-proposition">
          命题
        </label>
        <textarea
          id="exploration-proposition"
          className="input min-h-28 w-full resize-y"
          placeholder="例如：各 harness 如何处理上下文压缩？"
          maxLength={MAX_PROPOSITION_LENGTH}
          value={proposition}
          onChange={(event) => setProposition(event.target.value)}
        />
        <div className="mt-1 flex justify-between text-[11px] text-muted">
          <span>中文或英文均可；系统会转换为代码检索词，在本地镜像中查找证据。</span>
          <span className="tabular-nums">
            {proposition.length} / {MAX_PROPOSITION_LENGTH}
          </span>
        </div>
      </div>

      <div>
        <span className="label mb-1.5 block">探索范围</span>
        {harnesses.length === 0 ? (
          <p className="text-xs text-muted">尚未添加任何 harness，请先到 Harness 管理页添加。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {harnesses.map((harness) => {
              const checked = selected.includes(harness.id);
              return (
                <label
                  key={harness.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                    checked
                      ? "border-accent/40 bg-accent-soft text-ink"
                      : "border-line bg-surface-2 text-muted"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-[var(--color-accent)]"
                    checked={checked}
                    onChange={() => toggle(harness.id)}
                  />
                  {harness.name}
                  {harness.enabled ? null : <span className="text-[10px]">（停用）</span>}
                </label>
              );
            })}
          </div>
        )}
        <p className="mt-1 text-[11px] text-muted">
          {selected.length === 0
            ? "至少选择一个 harness。"
            : `将检索 ${selected.length} 个 harness 的本地镜像。`}
        </p>
      </div>

      {error ? <p className="text-xs text-danger">{error}</p> : null}

      <div className="flex items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={submit} disabled={disabled}>
          <Compass size={13} className={submitting ? "animate-spin" : ""} />
          {submitting ? "提交中…" : "开始探索"}
        </button>
        {tooShort && trimmed.length > 0 ? (
          <span className="text-[11px] text-muted">命题至少 {MIN_PROPOSITION_LENGTH} 个字符。</span>
        ) : null}
      </div>
    </div>
  );
}
