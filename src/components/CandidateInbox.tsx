"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CandidateStatus, SupportStatus } from "@/lib/types";

export interface CandidateInboxItem {
  id: number;
  harnessId: number;
  harnessName: string;
  name: string;
  description: string | null;
  evidence: string | null;
  confidence: number;
  moduleKey: string | null;
  createdDay: string;
  status: CandidateStatus;
  reviewedDay: string | null;
  commitId: number | null;
}

export interface CandidateCheckItem {
  candidateId: number;
  harnessId: number;
  harnessName: string;
  status: SupportStatus;
  evidence: string | null;
  note: string | null;
}

export interface HarnessOption {
  id: number;
  name: string;
}

export interface ModuleOption {
  key: string;
  name: string;
}

interface CandidateInboxProps {
  candidates: CandidateInboxItem[];
  checks: CandidateCheckItem[];
  harnesses: HarnessOption[];
  modules: ModuleOption[];
}

const STATUS_OPTIONS: Array<{ value: SupportStatus; label: string }> = [
  { value: "yes", label: "✓ 支持" },
  { value: "partial", label: "◐ 部分支持" },
  { value: "no", label: "✗ 不支持" },
  { value: "unknown", label: "? 待确认" },
];

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function defaultFeatureKey(candidate: CandidateInboxItem): string {
  const moduleKey = candidate.moduleKey ?? "ext";
  const slug = slugifyName(candidate.name);
  return `${moduleKey}.${slug || `candidate-${candidate.id}`}`;
}

export default function CandidateInbox({
  candidates,
  checks,
  harnesses,
  modules,
}: CandidateInboxProps) {
  const router = useRouter();
  const [tab, setTab] = useState<"pending" | "reviewed">("pending");
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const pending = candidates.filter((candidate) => candidate.status === "pending");
  const reviewed = candidates.filter((candidate) => candidate.status !== "pending");
  const visible = tab === "pending" ? pending : reviewed;

  const checksFor = (candidateId: number) =>
    checks.filter((check) => check.candidateId === candidateId);

  const reject = async (candidateId: number) => {
    setBusyId(candidateId);
    setMessage(null);
    setIsError(false);
    try {
      const response = await fetch(`/api/candidates/${candidateId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });
      const payload = (await response.json()) as { success: boolean; error?: string | null };
      if (!response.ok || !payload.success) {
        setIsError(true);
        setMessage(payload.error ?? "驳回失败");
        return;
      }
      setMessage("已驳回候选");
      router.refresh();
    } catch {
      setIsError(true);
      setMessage("网络错误，驳回失败");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`btn ${tab === "pending" ? "btn-primary" : ""}`}
          onClick={() => setTab("pending")}
        >
          待确认 <span className="ml-1 text-[11px] opacity-70">{pending.length}</span>
        </button>
        <button
          type="button"
          className={`btn ${tab === "reviewed" ? "btn-primary" : ""}`}
          onClick={() => setTab("reviewed")}
        >
          已处理 <span className="ml-1 text-[11px] opacity-70">{reviewed.length}</span>
        </button>
        {message ? (
          <span className={`ml-auto text-xs ${isError ? "text-danger" : "text-muted"}`}>
            {message}
          </span>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
          <p className="text-sm font-medium">
            {tab === "pending" ? "没有待确认的新功能候选" : "还没有已处理的候选"}
          </p>
          <p className="mt-1 text-xs text-muted">
            同步 feature 类提交后，系统会自动提炼候选并交叉检查其他 harness。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((candidate) => {
            const candidateChecks = checksFor(candidate.id);
            return (
              <section key={candidate.id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold">{candidate.name}</h2>
                      <span className="chip">{candidate.harnessName}</span>
                      {candidate.moduleKey ? (
                        <span className="chip font-mono">{candidate.moduleKey}</span>
                      ) : null}
                      <span className="chip">
                        置信度 {(candidate.confidence * 100).toFixed(0)}%
                      </span>
                      {candidate.status !== "pending" ? (
                        <span className="chip">
                          {candidate.status === "accepted" ? "已采纳" : "已驳回"}
                        </span>
                      ) : null}
                    </div>
                    {candidate.description ? (
                      <p className="mt-1.5 text-xs leading-relaxed text-muted">
                        {candidate.description}
                      </p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-muted">
                      <span>{candidate.createdDay}</span>
                      {candidate.evidence ? (
                        <span className="font-mono">{candidate.evidence}</span>
                      ) : null}
                      {candidate.commitId ? (
                        <Link
                          href={`/commits/${candidate.commitId}`}
                          className="text-accent hover:underline"
                        >
                          查看来源提交 ↗
                        </Link>
                      ) : null}
                      {candidate.reviewedDay ? <span>处理于 {candidate.reviewedDay}</span> : null}
                    </div>
                  </div>
                  {candidate.status === "pending" ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => reject(candidate.id)}
                        disabled={busyId === candidate.id}
                      >
                        驳回
                      </button>
                    </div>
                  ) : null}
                </div>

                {candidateChecks.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {candidateChecks.map((check) => (
                      <span key={check.harnessId} className="chip">
                        {check.harnessName}:{" "}
                        {STATUS_OPTIONS.find((option) => option.value === check.status)?.label}
                      </span>
                    ))}
                  </div>
                ) : null}

                {candidate.status === "pending" ? (
                  <AcceptForm
                    candidate={candidate}
                    checks={candidateChecks}
                    harnesses={harnesses}
                    modules={modules}
                    onResult={(text, error) => {
                      setMessage(text);
                      setIsError(error);
                      if (!error) router.refresh();
                    }}
                  />
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AcceptForm({
  candidate,
  checks,
  harnesses,
  modules,
  onResult,
}: {
  candidate: CandidateInboxItem;
  checks: CandidateCheckItem[];
  harnesses: HarnessOption[];
  modules: ModuleOption[];
  onResult: (message: string, isError: boolean) => void;
}) {
  const [featureKey, setFeatureKey] = useState(defaultFeatureKey(candidate));
  const [name, setName] = useState(candidate.name);
  const [moduleKey, setModuleKey] = useState(candidate.moduleKey ?? modules[0]?.key ?? "");
  const [statuses, setStatuses] = useState<Record<number, SupportStatus>>(() =>
    Object.fromEntries(
      harnesses.map((harness) => {
        const check = checks.find((entry) => entry.harnessId === harness.id);
        if (check) return [harness.id, check.status];
        return [harness.id, harness.id === candidate.harnessId ? "yes" : "unknown"];
      }),
    ),
  );
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const support = harnesses
        .filter((harness) => statuses[harness.id] !== "unknown")
        .map((harness) => {
          const check = checks.find((entry) => entry.harnessId === harness.id);
          const note =
            harness.id === candidate.harnessId ? notes.trim() || null : (check?.note ?? null);
          return {
            harnessId: harness.id,
            status: statuses[harness.id],
            notes: note,
            evidence: check?.evidence ?? null,
          };
        });

      if (support.length === 0) {
        setError("至少为一个 harness 选择状态");
        return;
      }

      const response = await fetch(`/api/candidates/${candidate.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "accept",
          featureKey: featureKey.trim(),
          moduleKey,
          name: name.trim(),
          support,
          note: `采纳候选「${candidate.name}」`,
        }),
      });
      const payload = (await response.json()) as {
        success: boolean;
        error?: string | null;
        data?: { featureKey?: string; version?: string | null };
      };
      if (!response.ok || !payload.success) {
        setError(payload.error ?? "采纳失败");
        onResult(payload.error ?? "采纳失败", true);
        return;
      }
      onResult(
        `已采纳为功能点 ${payload.data?.featureKey ?? featureKey}，基线版本 ${
          payload.data?.version ?? "已更新"
        }`,
        false,
      );
    } catch {
      setError("网络错误，采纳失败");
      onResult("网络错误，采纳失败", true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className="mt-3 border-t border-line pt-3">
      <summary className="cursor-pointer text-xs font-medium text-accent">并入基线…</summary>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div>
          <label className="label" htmlFor="candidate-feature-key">
            功能点 key
          </label>
          <input
            id="candidate-feature-key"
            className="input font-mono text-xs"
            value={featureKey}
            onChange={(event) => setFeatureKey(event.target.value)}
            placeholder="module.feature"
          />
        </div>
        <div>
          <label className="label" htmlFor="candidate-feature-name">
            名称
          </label>
          <input
            id="candidate-feature-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="candidate-feature-module">
            模块
          </label>
          <select
            id="candidate-feature-module"
            className="input"
            value={moduleKey}
            onChange={(event) => setModuleKey(event.target.value)}
          >
            {modules.map((module) => (
              <option key={module.key} value={module.key}>
                {module.name}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="min-w-0 border-0 p-0 md:col-span-3">
          <legend className="label">各 harness 支持状态</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {harnesses.map((harness) => (
              <label
                key={harness.id}
                className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-[11px]">{harness.name}</span>
                <select
                  className="input w-28 px-1 py-0.5 text-[11px]"
                  value={statuses[harness.id] ?? "unknown"}
                  onChange={(event) =>
                    setStatuses((previous) => ({
                      ...previous,
                      [harness.id]: event.target.value as SupportStatus,
                    }))
                  }
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="md:col-span-3">
          <label className="label" htmlFor="candidate-feature-notes">
            备注（写入来源 harness 的支持说明）
          </label>
          <input
            id="candidate-feature-notes"
            className="input"
            maxLength={2000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="实现要点、证据路径等"
          />
        </div>
      </div>
      {error ? <p className="mt-2 text-[11px] text-danger">{error}</p> : null}
      <div className="mt-3">
        <button
          type="button"
          className="btn btn-primary"
          onClick={submit}
          disabled={saving || !featureKey.trim()}
        >
          {saving ? "提交中…" : "确认并入基线"}
        </button>
      </div>
    </details>
  );
}
