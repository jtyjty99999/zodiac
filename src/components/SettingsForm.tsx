"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface SettingsInitial {
  aiEnabled: boolean;
  aiModel: string;
  aiMaxPerSync: number;
  timezone: string;
  exploreEngine: "api" | "claude-code";
  claudeCodeCommand: string;
}

interface SettingsFormProps {
  initial: SettingsInitial;
}

const TIMEZONES = [
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Singapore",
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
];

export default function SettingsForm({ initial }: SettingsFormProps) {
  const router = useRouter();
  const [aiEnabled, setAiEnabled] = useState(initial.aiEnabled);
  const [aiModel, setAiModel] = useState(initial.aiModel);
  const [aiMaxPerSync, setAiMaxPerSync] = useState(String(initial.aiMaxPerSync));
  const [timezone, setTimezone] = useState(initial.timezone);
  const [exploreEngine, setExploreEngine] = useState(initial.exploreEngine);
  const [claudeCodeCommand, setClaudeCodeCommand] = useState(initial.claudeCodeCommand);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const commandMissing = exploreEngine === "claude-code" && claudeCodeCommand.trim().length === 0;

  const save = async () => {
    if (commandMissing) return;
    setSaving(true);
    setMessage(null);
    setIsError(false);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiEnabled,
          aiModel: aiModel.trim(),
          aiMaxPerSync: Number(aiMaxPerSync) || 0,
          timezone,
          exploreEngine,
          claudeCodeCommand: claudeCodeCommand.trim(),
        }),
      });
      const payload = (await response.json()) as { success: boolean; error?: string | null };
      if (!response.ok || !payload.success) {
        setIsError(true);
        setMessage(payload.error ?? "保存失败");
        return;
      }
      setMessage("设置已保存");
      router.refresh();
    } catch {
      setIsError(true);
      setMessage("网络错误，保存失败");
    } finally {
      setSaving(false);
    }
  };

  const zones = TIMEZONES.includes(timezone) ? TIMEZONES : [timezone, ...TIMEZONES];

  return (
    <section className="card p-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex items-start gap-3 rounded-lg border border-line p-3">
          <input
            type="checkbox"
            className="mt-0.5 accent-[var(--z-accent)]"
            checked={aiEnabled}
            onChange={(event) => setAiEnabled(event.target.checked)}
          />
          <span>
            <span className="block text-sm font-medium">启用 Claude 增强分析</span>
            <span className="mt-0.5 block text-[11px] text-muted">
              需要设置 ANTHROPIC_API_KEY；未启用时仅使用启发式分类、评级与点评。
            </span>
          </span>
        </label>

        <div>
          <label className="label" htmlFor="settings-ai-model">
            模型
          </label>
          <input
            id="settings-ai-model"
            className="input font-mono text-xs"
            value={aiModel}
            onChange={(event) => setAiModel(event.target.value)}
            placeholder="claude-sonnet-5"
          />
          <p className="mt-1 text-[11px] text-muted">
            默认 claude-sonnet-5，可通过 ANTHROPIC_MODEL 覆盖。
          </p>
        </div>

        <div>
          <label className="label" htmlFor="settings-ai-limit">
            每次同步的 AI 分析上限
          </label>
          <input
            id="settings-ai-limit"
            className="input"
            type="number"
            min={0}
            max={200}
            value={aiMaxPerSync}
            onChange={(event) => setAiMaxPerSync(event.target.value)}
          />
          <p className="mt-1 text-[11px] text-muted">0 表示不调用 AI；超出部分仍走启发式分析。</p>
        </div>

        <div>
          <label className="label" htmlFor="settings-timezone">
            时区（按天归档）
          </label>
          <select
            id="settings-timezone"
            className="input"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-muted">默认 Asia/Shanghai，可通过 ZODIAC_TZ 覆盖。</p>
        </div>

        <div className="border-t border-line pt-3 md:col-span-2">
          <p className="text-sm font-medium">功能探索引擎</p>
          <p className="mt-0.5 text-[11px] text-muted">
            API 模式由 Claude 通过工具调用探索；本地模式直接调用已登录的 Claude Code CLI，不消耗
            ANTHROPIC_API_KEY。
          </p>
        </div>

        <div>
          <label className="label" htmlFor="settings-explore-engine">
            探索引擎
          </label>
          <select
            id="settings-explore-engine"
            className="input"
            value={exploreEngine}
            onChange={(event) =>
              setExploreEngine(event.target.value === "claude-code" ? "claude-code" : "api")
            }
          >
            <option value="api">Anthropic API（默认）</option>
            <option value="claude-code">本地 Claude Code CLI</option>
          </select>
          <p className="mt-1 text-[11px] text-muted">
            本地模式需先安装并登录 Claude Code，失败时自动回退到离线检索。
          </p>
        </div>

        <div>
          <label className="label" htmlFor="settings-claude-command">
            Claude Code 命令
          </label>
          <input
            id="settings-claude-command"
            className="input font-mono text-xs"
            value={claudeCodeCommand}
            onChange={(event) => setClaudeCodeCommand(event.target.value)}
            placeholder="claude"
          />
          <p className="mt-1 text-[11px] text-muted">
            仅为命令名或绝对路径（不经过 shell）；运行时使用只读受限模式与临时快照。
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={saving || commandMissing}
        >
          {saving ? "保存中…" : "保存设置"}
        </button>
        {message ? (
          <span className={`text-xs ${isError ? "text-danger" : "text-muted"}`}>{message}</span>
        ) : null}
        {commandMissing ? (
          <span className="text-xs text-danger">本地模式需要填写 Claude Code 命令。</span>
        ) : null}
      </div>
    </section>
  );
}
