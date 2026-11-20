import SettingsForm from "@/components/SettingsForm";
import { PageHeader, SectionCard } from "@/components/ui";
import { getAiConfig } from "@/lib/analysis/anthropic";
import { getDb } from "@/lib/db/client";
import { getAllSettings } from "@/lib/db/repositories/settings";
import {
  getExplorationEngineSettings,
  LOCAL_ENGINE_KINDS,
  LOCAL_ENGINE_LABELS,
  localCommandFor,
} from "@/lib/explore/engineSettings";
import { getLocalEngineStatus } from "@/lib/localEngine";
import { getTimezone } from "@/lib/utils/time";

export const metadata = { title: "设置" };

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-xs">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-success" : "bg-warning"}`} />
        {value}
      </span>
    </div>
  );
}

export default async function SettingsPage() {
  const db = getDb();
  const ai = getAiConfig(db);
  const settings = getAllSettings(db);
  const engineSettings = getExplorationEngineSettings(db);
  const localStatuses = await Promise.all(
    LOCAL_ENGINE_KINDS.map((engine) =>
      getLocalEngineStatus(engine, localCommandFor(engineSettings, engine)),
    ),
  );
  const selectedEngine = engineSettings.engine;
  const storedAiEnabled = settings.aiEnabled;
  const initial = {
    aiEnabled: storedAiEnabled === null ? ai.hasKey : storedAiEnabled === "true",
    aiModel: ai.model,
    aiMaxPerSync: ai.maxPerSync,
    timezone: getTimezone(),
    exploreEngine: engineSettings.engine,
    claudeCodeCommand: engineSettings.command,
    codexCommand: engineSettings.codexCommand,
    deepseekCommand: engineSettings.deepseekCommand,
  };

  const schedulerEnabled = process.env.ZODIAC_SCHEDULER !== "off";
  const hasGithubToken = Boolean(process.env.GITHUB_TOKEN?.trim());
  const selectedStatus =
    selectedEngine === "api"
      ? null
      : localStatuses.find((status) => status.engine === selectedEngine);

  return (
    <div>
      <PageHeader
        title="设置"
        description="分析引擎、归档时区与本地环境状态。密钥类配置通过环境变量提供，不会写入数据库。"
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <SettingsForm initial={initial} />

        <div className="space-y-4">
          <SectionCard title="环境状态">
            <StatusRow
              label="ANTHROPIC_API_KEY"
              value={ai.hasKey ? "已配置" : "未配置"}
              ok={ai.hasKey}
            />
            <StatusRow label="AI 分析" value={ai.enabled ? "已启用" : "未启用"} ok={ai.enabled} />
            <StatusRow
              label="当前 AI 引擎"
              value={
                selectedEngine === "api" ? "Anthropic API" : LOCAL_ENGINE_LABELS[selectedEngine]
              }
              ok={selectedEngine === "api" ? ai.hasKey : Boolean(selectedStatus?.available)}
            />
            {localStatuses.map((status) => (
              <StatusRow
                key={status.engine}
                label={`${LOCAL_ENGINE_LABELS[status.engine]}（${status.command}）`}
                value={status.available ? (status.version ?? "可用") : "不可用"}
                ok={status.available}
              />
            ))}
            <StatusRow
              label="后台调度器"
              value={schedulerEnabled ? "运行中" : "已关闭"}
              ok={schedulerEnabled}
            />
            <StatusRow
              label="GITHUB_TOKEN"
              value={hasGithubToken ? "已配置（发版 API 提额）" : "未配置（匿名 + tags 回退）"}
              ok={hasGithubToken}
            />
          </SectionCard>

          <SectionCard title="环境变量">
            <ul className="space-y-1.5 font-mono text-[11px] text-muted">
              <li>ZODIAC_TZ — 归档时区</li>
              <li>ZODIAC_DB_PATH — SQLite 路径</li>
              <li>ZODIAC_SCHEDULER=off — 关闭定时同步</li>
              <li>ZODIAC_LOCAL_ENGINE=off — 禁用全部本地引擎</li>
              <li>ZODIAC_LOCAL_CLAUDE=off — 仅禁用本地 Claude Code</li>
              <li>ANTHROPIC_API_KEY / ANTHROPIC_MODEL</li>
              <li>GITHUB_TOKEN — GitHub Releases API</li>
            </ul>
          </SectionCard>
        </div>
      </div>

      <p className="mt-4 text-[11px] text-muted">
        提示：AI 调用有每次同步的条数上限与超时保护，失败时自动回退到启发式分析。本地引擎（Claude
        Code / Codex / DeepSeek
        Harness）在临时快照与只读沙箱中运行，失败时同样回退到离线检索或启发式分析。
      </p>
    </div>
  );
}
