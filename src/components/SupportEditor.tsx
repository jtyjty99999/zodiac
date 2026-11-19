"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { SupportStatus } from "@/lib/types";

export interface SupportEditorRow {
  harnessId: number;
  harnessName: string;
  status: SupportStatus;
  notes: string | null;
  evidence: string | null;
}

interface SupportEditorProps {
  featureId: number;
  featureName: string;
  rows: SupportEditorRow[];
}

const STATUS_OPTIONS: Array<{ value: SupportStatus; label: string }> = [
  { value: "yes", label: "✓ 支持" },
  { value: "partial", label: "◐ 部分支持" },
  { value: "no", label: "✗ 不支持" },
  { value: "unknown", label: "? 待确认" },
];

export default function SupportEditor({ featureId, featureName, rows }: SupportEditorProps) {
  const router = useRouter();
  const [harnessId, setHarnessId] = useState(rows[0]?.harnessId ?? 0);
  const current = rows.find((row) => row.harnessId === harnessId) ?? rows[0];
  const [status, setStatus] = useState<SupportStatus>(current?.status ?? "unknown");
  const [notes, setNotes] = useState(current?.notes ?? "");
  const [evidence, setEvidence] = useState(current?.evidence ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const row = rows.find((entry) => entry.harnessId === harnessId);
    setStatus(row?.status ?? "unknown");
    setNotes(row?.notes ?? "");
    setEvidence(row?.evidence ?? "");
    setMessage(null);
  }, [harnessId, rows]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/features/${featureId}/support`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          featureId,
          harnessId,
          status,
          notes: notes.trim() || null,
          evidence: evidence.trim() || null,
        }),
      });
      const payload = (await response.json()) as {
        success: boolean;
        error?: string | null;
        data?: { version: string | null };
      };
      if (!response.ok || !payload.success) {
        setMessage(payload.error ?? "保存失败");
        return;
      }
      setMessage(payload.data?.version ? `已保存，基线版本 ${payload.data.version}` : "已保存");
      router.refresh();
    } catch {
      setMessage("网络错误，保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (rows.length === 0) return null;

  return (
    <details className="card mt-5 p-4">
      <summary className="cursor-pointer text-sm font-medium">
        编辑支持状态{" "}
        <span className="text-xs font-normal text-muted">（更新后会生成带日期的基线版本）</span>
      </summary>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="support-harness">
            Harness
          </label>
          <select
            id="support-harness"
            className="input"
            value={harnessId}
            onChange={(event) => setHarnessId(Number(event.target.value))}
          >
            {rows.map((row) => (
              <option key={row.harnessId} value={row.harnessId}>
                {row.harnessName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="support-status">
            状态 · {featureName}
          </label>
          <select
            id="support-status"
            className="input"
            value={status}
            onChange={(event) => setStatus(event.target.value as SupportStatus)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="support-notes">
            备注
          </label>
          <textarea
            id="support-notes"
            className="input min-h-[72px]"
            maxLength={4000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="实现要点、限制或差异说明"
          />
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="support-evidence">
            证据（文件路径，每行一个）
          </label>
          <textarea
            id="support-evidence"
            className="input min-h-[60px] font-mono text-xs"
            maxLength={4000}
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
            placeholder="packages/foo/src/bar.ts"
          />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? "保存中…" : "保存状态"}
        </button>
        {message ? <span className="text-xs text-muted">{message}</span> : null}
      </div>
    </details>
  );
}
