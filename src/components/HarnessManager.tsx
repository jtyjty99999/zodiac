"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Harness, ScheduleMode } from "@/lib/types";
import SyncButton from "./SyncButton";

export interface SyncRunSummary {
  id: number;
  harnessId: number;
  harnessName: string;
  trigger: string;
  phase: string;
  status: "running" | "success" | "failed";
  newCommits: number;
  newReleases: number;
  startedAt: string;
  error: string | null;
}

interface HarnessManagerProps {
  harnesses: Harness[];
  runs: SyncRunSummary[];
}

interface NewHarnessForm {
  slug: string;
  name: string;
  repoUrl: string;
  branch: string;
  scheduleMode: ScheduleMode;
  dailyTime: string;
  backfillDays: string;
}

const EMPTY_FORM: NewHarnessForm = {
  slug: "",
  name: "",
  repoUrl: "",
  branch: "main",
  scheduleMode: "daily",
  dailyTime: "09:17",
  backfillDays: "30",
};

const SCHEDULE_LABELS: Record<ScheduleMode, string> = {
  off: "关闭",
  hourly: "每小时",
  daily: "每天",
};

async function postJson(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<{ ok: boolean; error: string | null }> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = (await response.json()) as { success: boolean; error?: string | null };
    if (!response.ok || !payload.success) {
      return { ok: false, error: payload.error ?? `请求失败（${response.status}）` };
    }
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: "网络错误" };
  }
}

export default function HarnessManager({ harnesses, runs }: HarnessManagerProps) {
  const router = useRouter();
  const [form, setForm] = useState<NewHarnessForm>(EMPTY_FORM);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [creating, setCreating] = useState(false);

  const submitCreate = async () => {
    setCreating(true);
    setMessage(null);
    const result = await postJson("/api/harnesses", "POST", {
      slug: form.slug.trim(),
      name: form.name.trim(),
      repoUrl: form.repoUrl.trim(),
      branch: form.branch.trim() || "main",
      scheduleMode: form.scheduleMode,
      dailyTime: form.dailyTime,
      backfillDays: Number(form.backfillDays) || 30,
    });
    setCreating(false);
    if (!result.ok) {
      setIsError(true);
      setMessage(result.error ?? "创建失败");
      return;
    }
    setIsError(false);
    setMessage(`已添加 ${form.name || form.slug}`);
    setForm(EMPTY_FORM);
    router.refresh();
  };

  return (
    <div className="space-y-5">
      {message ? (
        <p className={`text-xs ${isError ? "text-danger" : "text-muted"}`}>{message}</p>
      ) : null}

      <div className="grid gap-3">
        {harnesses.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line px-6 py-8 text-center text-sm text-muted">
            还没有 harness。使用下面的表单添加第一个仓库。
          </div>
        ) : (
          harnesses.map((harness) => (
            <HarnessCard
              key={harness.id}
              harness={harness}
              runs={runs.filter((run) => run.harnessId === harness.id)}
              onChanged={() => router.refresh()}
            />
          ))
        )}
      </div>

      <section className="card p-4">
        <h2 className="text-sm font-semibold">添加 Harness</h2>
        <p className="mt-1 text-[11px] text-muted">
          支持 https/git/ssh 的 owner/repo 地址，例如 https://github.com/openai/codex。
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div>
            <label className="label" htmlFor="harness-new-slug">
              slug
            </label>
            <input
              id="harness-new-slug"
              className="input font-mono"
              value={form.slug}
              onChange={(event) => setForm({ ...form, slug: event.target.value })}
              placeholder="codex"
            />
          </div>
          <div>
            <label className="label" htmlFor="harness-new-name">
              名称
            </label>
            <input
              id="harness-new-name"
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Codex"
            />
          </div>
          <div>
            <label className="label" htmlFor="harness-new-repo">
              仓库地址
            </label>
            <input
              id="harness-new-repo"
              className="input"
              value={form.repoUrl}
              onChange={(event) => setForm({ ...form, repoUrl: event.target.value })}
              placeholder="https://github.com/owner/repo"
            />
          </div>
          <div>
            <label className="label" htmlFor="harness-new-branch">
              分支
            </label>
            <input
              id="harness-new-branch"
              className="input font-mono"
              value={form.branch}
              onChange={(event) => setForm({ ...form, branch: event.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="harness-new-schedule">
              调度
            </label>
            <select
              id="harness-new-schedule"
              className="input"
              value={form.scheduleMode}
              onChange={(event) =>
                setForm({ ...form, scheduleMode: event.target.value as ScheduleMode })
              }
            >
              <option value="daily">每天</option>
              <option value="hourly">每小时</option>
              <option value="off">关闭</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="harness-new-daily">
              每日时刻
            </label>
            <div className="flex gap-2">
              <input
                id="harness-new-daily"
                className="input w-24"
                type="time"
                value={form.dailyTime}
                onChange={(event) => setForm({ ...form, dailyTime: event.target.value })}
              />
              <input
                aria-label="回填天数"
                className="input"
                type="number"
                min={1}
                max={3650}
                value={form.backfillDays}
                onChange={(event) => setForm({ ...form, backfillDays: event.target.value })}
              />
            </div>
          </div>
        </div>
        <div className="mt-3">
          <button
            type="button"
            className="btn btn-primary"
            onClick={submitCreate}
            disabled={creating || !form.slug.trim() || !form.name.trim() || !form.repoUrl.trim()}
          >
            {creating ? "添加中…" : "添加 Harness"}
          </button>
        </div>
      </section>
    </div>
  );
}

function HarnessCard({
  harness,
  runs,
  onChanged,
}: {
  harness: Harness;
  runs: SyncRunSummary[];
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState({
    name: harness.name,
    repoUrl: harness.repoUrl,
    branch: harness.branch,
    scheduleMode: harness.scheduleMode,
    dailyTime: harness.dailyTime,
    backfillDays: String(harness.backfillDays),
    sortOrder: String(harness.sortOrder),
  });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const save = async () => {
    setSaving(true);
    setFeedback(null);
    const result = await postJson(`/api/harnesses/${harness.id}`, "PATCH", {
      name: draft.name.trim(),
      repoUrl: draft.repoUrl.trim(),
      branch: draft.branch.trim(),
      scheduleMode: draft.scheduleMode,
      dailyTime: draft.dailyTime,
      backfillDays: Number(draft.backfillDays) || 30,
      sortOrder: Number(draft.sortOrder) || 0,
    });
    setSaving(false);
    setIsError(!result.ok);
    setFeedback(result.ok ? "已保存" : (result.error ?? "保存失败"));
    if (result.ok) onChanged();
  };

  const toggleEnabled = async () => {
    const result = await postJson(`/api/harnesses/${harness.id}`, "PATCH", {
      enabled: !harness.enabled,
    });
    setIsError(!result.ok);
    setFeedback(result.ok ? (harness.enabled ? "已停用" : "已启用") : (result.error ?? "操作失败"));
    if (result.ok) onChanged();
  };

  const remove = async () => {
    const confirmed = window.confirm(
      `删除 ${harness.name}？其提交、发版、同步记录与候选都会被一并删除，此操作不可撤销。`,
    );
    if (!confirmed) return;
    const result = await postJson(`/api/harnesses/${harness.id}`, "DELETE");
    setIsError(!result.ok);
    setFeedback(result.ok ? "已删除" : (result.error ?? "删除失败"));
    if (result.ok) onChanged();
  };

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{harness.name}</h2>
            <span className="chip font-mono">{harness.slug}</span>
            <span className="chip">{harness.enabled ? "启用" : "停用"}</span>
            <span className="chip">
              {SCHEDULE_LABELS[harness.scheduleMode]}
              {harness.scheduleMode === "daily" ? ` ${harness.dailyTime}` : ""}
            </span>
          </div>
          <p className="mt-1 break-all font-mono text-[11px] text-muted">{harness.repoUrl}</p>
          <p className="mt-1 text-[11px] text-muted">
            上次同步{" "}
            {harness.lastSyncAt ? new Date(harness.lastSyncAt).toLocaleString("zh-CN") : "从未"}
            {" · "}
            上次成功{" "}
            {harness.lastSuccessAt
              ? new Date(harness.lastSuccessAt).toLocaleString("zh-CN")
              : "从未"}
          </p>
          {harness.lastError ? (
            <p className="mt-1 rounded-md bg-danger/10 px-2 py-1 text-[11px] text-danger">
              {harness.lastError}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <SyncButton harnessId={harness.id} compact label="同步" />
          <button type="button" className="btn px-2 py-1 text-[11px]" onClick={toggleEnabled}>
            {harness.enabled ? "停用" : "启用"}
          </button>
          <button
            type="button"
            className="btn px-2 py-1 text-[11px] text-danger"
            onClick={remove}
            aria-label="删除"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      <details className="mt-3 border-t border-line pt-3">
        <summary className="cursor-pointer text-[11px] font-medium text-accent">编辑配置</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div>
            <label className="label" htmlFor={`harness-${harness.id}-name`}>
              名称
            </label>
            <input
              id={`harness-${harness.id}-name`}
              className="input"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor={`harness-${harness.id}-repo`}>
              仓库地址
            </label>
            <input
              id={`harness-${harness.id}-repo`}
              className="input font-mono text-xs"
              value={draft.repoUrl}
              onChange={(event) => setDraft({ ...draft, repoUrl: event.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor={`harness-${harness.id}-branch`}>
              分支
            </label>
            <input
              id={`harness-${harness.id}-branch`}
              className="input font-mono"
              value={draft.branch}
              onChange={(event) => setDraft({ ...draft, branch: event.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor={`harness-${harness.id}-schedule`}>
              调度
            </label>
            <select
              id={`harness-${harness.id}-schedule`}
              className="input"
              value={draft.scheduleMode}
              onChange={(event) =>
                setDraft({ ...draft, scheduleMode: event.target.value as ScheduleMode })
              }
            >
              <option value="daily">每天</option>
              <option value="hourly">每小时</option>
              <option value="off">关闭</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor={`harness-${harness.id}-daily`}>
              每日时刻
            </label>
            <input
              id={`harness-${harness.id}-daily`}
              className="input"
              type="time"
              value={draft.dailyTime}
              onChange={(event) => setDraft({ ...draft, dailyTime: event.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor={`harness-${harness.id}-backfill`}>
              回填天数
            </label>
            <input
              id={`harness-${harness.id}-backfill`}
              className="input"
              type="number"
              min={1}
              max={3650}
              value={draft.backfillDays}
              onChange={(event) => setDraft({ ...draft, backfillDays: event.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor={`harness-${harness.id}-sort`}>
              排序
            </label>
            <input
              id={`harness-${harness.id}-sort`}
              className="input"
              type="number"
              min={0}
              value={draft.sortOrder}
              onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })}
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "保存中…" : "保存配置"}
          </button>
          {feedback ? (
            <span className={`text-[11px] ${isError ? "text-danger" : "text-muted"}`}>
              {feedback}
            </span>
          ) : null}
        </div>
      </details>

      {runs.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] text-muted">
            最近同步记录（{runs.length}）
          </summary>
          <ul className="mt-2 space-y-1">
            {runs.map((run) => (
              <li key={run.id} className="flex items-center gap-2 text-[11px]">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    run.status === "success"
                      ? "bg-success"
                      : run.status === "failed"
                        ? "bg-danger"
                        : "animate-pulse bg-warning"
                  }`}
                />
                <span className="w-36 text-muted">
                  {new Date(run.startedAt).toLocaleString("zh-CN")}
                </span>
                <span className="text-muted">{run.trigger}</span>
                <span className="text-muted">{run.phase}</span>
                <span className="ml-auto tabular-nums text-muted">
                  +{run.newCommits} 提交 / +{run.newReleases} 发版
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
