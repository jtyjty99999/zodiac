"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type ExploreEngineValue = "api" | "claude-code" | "codex" | "deepseek";

export interface SettingsInitial {
  aiEnabled: boolean;
  aiModel: string;
  aiMaxPerSync: number;
  timezone: string;
  exploreEngine: ExploreEngineValue;
  claudeCodeCommand: string;
  codexCommand: string;
  deepseekCommand: string;
}

interface SettingsFormProps {
  initial: SettingsInitial;
}

const ENGINE_OPTIONS: Array<{ value: ExploreEngineValue; label: string }> = [
  { value: "api", label: "Anthropic API（默认）" },
  { value: "claude-code", label: "本地 Claude Code CLI" },
  { value: "codex", label: "本地 Codex CLI" },
  { value: "deepseek", label: "本地 DeepSeek Harness（dsh）" },
];

const LOCAL_ENGINE_DEFAULTS: Record<Exclude<ExploreEngineValue, "api">, string> = {
  "claude-code": "claude",
  codex: "codex",
  deepseek: "dsh",
};

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
  const [exploreEngine, setExploreEngine] = useState<ExploreEngineValue>(initial.exploreEngine);
  const [claudeCodeCommand, setClaudeCodeCommand] = useState(initial.claudeCodeCommand);
  const [codexCommand, setCodexCommand] = useState(initial.codexCommand);
  const [deepseekCommand, setDeepseekCommand] = useState(initial.deepseekCommand);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const commands: Record<Exclude<ExploreEngineValue, "api">, [string, (value: string) => void]> = {
    "claude-code": [claudeCodeCommand, setClaudeCodeCommand],
    codex: [codexCommand, setCodexCommand],
    deepseek: [deepseekCommand, setDeepseekCommand],
  };
  const activeCommand = exploreEngine === "api" ? null : commands[exploreEngine][0];
  const commandMissing = activeCommand !== null && activeCommand.trim().length === 0;

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
          codexCommand: codexCommand.trim(),
          deepseekCommand: deepseekCommand.trim(),
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
          <p className="text-sm font-medium">AI 引擎（功能探索 / AI 重审 / 提交点评）</p>
          <p className="mt-0.5 text-[11px] text-muted">
            API 模式通过 Anthropic API 调用；本地模式直接调用已安装并登录的 CLI，不消耗
            ANTHROPIC_API_KEY。未配置 API 时，提交点评、功能重审与探索都会使用这里选择的本地引擎。
          </p>
        </div>

        <div>
          <label className="label" htmlFor="settings-explore-engine">
            引擎
          </label>
          <select
            id="settings-explore-engine"
            className="input"
            value={exploreEngine}
            onChange={(event) => setExploreEngine(event.target.value as ExploreEngineValue)}
          >
            {ENGINE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-muted">
            本地引擎失败时自动回退到离线检索 / 启发式分析。
          </p>
        </div>

        {(["claude-code", "codex", "deepseek"] as const).map((engine) => {
          const [value, setValue] = commands[engine];
          return (
            <div key={engine}>
              <label className="label" htmlFor={`settings-${engine}-command`}>
                {engine === "claude-code"
                  ? "Claude Code"
                  : engine === "codex"
                    ? "Codex"
                    : "DeepSeek Harness"}{" "}
                命令
              </label>
              <input
                id={`settings-${engine}-command`}
                className="input font-mono text-xs"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={LOCAL_ENGINE_DEFAULTS[engine]}
              />
              <p className="mt-1 text-[11px] text-muted">
                仅为命令名或绝对路径（不经过 shell）；运行时使用只读快照与临时工作目录。
              </p>
            </div>
          );
        })}
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
          <span className="text-xs text-danger">本地模式需要填写所选引擎的命令。</span>
        ) : null}
      </div>
    </section>
  );
}
