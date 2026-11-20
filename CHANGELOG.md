# Changelog

按时间倒序记录每次迭代做了什么。每条对应一次提交（短 SHA），写清新增/调整的功能点、关键文件与行为变化。

维护约定：每次提交时在本文件顶部追加一条，写明类型、影响的模块与用户可见的变化；纯内部重构也要记录。

---

## 2026-11-20

### feat: AI 引擎支持本地 Codex 与 DeepSeek Harness（本次提交）

- **统一本地引擎层**：新增 `src/lib/localEngine/`，把「探测版本 + 无头调用 + 解析 JSON」抽成统一适配器，支持 Claude Code（`claude -p … --json-schema`）、Codex（`codex exec --sandbox read-only --ephemeral --output-last-message …`，提示词走 stdin）与 DeepSeek Harness（`dsh --profile headless "…"`）。
- **三处调用点接入**：提交评审、按功能点 AI 重审、功能探索都按「API 优先，回退所选本地引擎」执行；`analyzed_by` / 审计引擎 / 探索引擎记录具体引擎（`codex`、`deepseek`），标签与报告同步展示。
- **设置页与 API**：引擎下拉新增本地 Codex / DeepSeek Harness，三个命令输入框独立配置（`codexCommand`、`deepseekCommand`），环境状态展示每种 CLI 的可用性与版本；环境变量 `ZODIAC_LOCAL_ENGINE=off` 可一次禁用全部本地引擎。
- **文档补齐**：`docs/usage.md` 设置章节补充本地 harness 对接（安装登录、无头参数、隔离方式与差异、回退与禁用开关），README 同步引擎说明、目录结构与用例数（336）。
- **测试**：新增 `tests/unit/local-engine.test.ts`，用假可执行文件覆盖三种 CLI 的参数、stdin、结果文件与失败路径；重审与探索相关用例适配多引擎配置。
### docs: 增加版本迭代时间线与后续计划 (`2319d01`)

- 新增本文件，按时间倒序整理历次提交做了什么，并在 README 顶部加入口。
- README 新增「后续计划（TBD）」：更多 harness、任务队列、多模型评审、基线版本差异、导出增强、探索缓存、通知、部署、窄屏适配、自动 changelog。

### feat: 深挖标记支持 AI 重审自动加入与手动切换 (`879690a`)

- **自动标记**：AI 重审成功后在写入 catalog 的同一事务内把功能点标记为深挖；重审失败不改变标记。`src/lib/features/run.ts`
- **手动切换**：新增 `POST /api/features/[id]/deep-dive`，同源校验 + 限流、Zod 校验、不存在返回 404、值未变化时幂等；真实切换会提交一次带日期的基线版本。对比页页头新增「设为深挖 / 取消深挖」按钮。
- **测试与文档**：仓储层、路由行为、重审成败路径均有覆盖；README 与 `docs/usage.md` 同步说明。

### feat: 评审收敛为精简代码解读，重新分析改为后台任务并支持刷新续接 (`8c8ad36`)

- **评审口径**：从逐行翻译代码收敛为 300–600 字（复杂提交 ≤1000），固定四段：解决的问题 / 具体改动（≤3–5 条）/ 实现解读（3–5 步，只引用关键函数）/ 影响与风险。diff、文件列表截断时在 prompt 中注明「未看到的部分」。
- **重新分析**：改为服务端后台任务——进程内 active 集合去重，`after()` 异步执行，接口立即返回 202；页面刷新后按服务端状态继续显示「分析中」，完成后自动刷新。
- **启发式回退**：同步改为四段式总结。`src/lib/analysis/anthropic.ts`、`src/lib/analysis/active.ts`、`src/app/api/commits/[id]/analyze/route.ts`

### feat: 按功能点 AI 重审并生成基线，提交点评改为评审式分析 (`e60ec1e`)

- **AI 重审功能点**：读取各 harness 的代码快照，重新判断支持状态、整理实现细节与横向差异，直接写入功能矩阵并生成可回滚的基线版本；模型给出的 `path:line` 证据逐一回到镜像验证，无效引用丢弃。
- **双引擎**：优先 Anthropic API，未配置或失败时回退本地 Claude Code CLI（只读受限模式 + 临时 worktree 快照）。
- **运行记录**：新增 `feature_audits` 表记录状态、报告与版本；对比页展示最近一次重审报告并可展开查看。`src/lib/features/audit.ts`、`src/lib/features/run.ts`
- **提交评审**：改为评审式结构，评级依据功能重要性、影响面与风险，不再按改动行数加分。

### feat: 探索支持 AI 自主探索与本地 Claude Code，并以分析报告为主 (`d670eb5`)

- **双引擎探索**：设置页可二选一——Anthropic API 应用内工具循环，或本地 Claude Code CLI（只读受限模式、复用本地登录态）。
- **只读工具集**：新增列目录、读文件、grep 等受限工具与临时 worktree 快照。`src/lib/explore/agent.ts`、`src/lib/explore/tools.ts`、`src/lib/git/snapshot.ts`
- **报告形态**：以跨 harness 分析为主，代码证据默认折叠在「代码证据」中，仍可溯源到 `path:line`。

### feat: 增加功能探索模块 (`eba4555`)

- **流程**：输入命题 → 关键词提取（英文 token、中文领域词典、bigram、功能目录匹配）→ 对所选 harness 的本地镜像做 `git grep` 检索 → 生成证据片段与跨 harness 对比报告。
- **页面与 API**：`/explore` 发起与历史列表，`/explore/[id]` 详情轮询；`POST/GET /api/explorations`、`GET/DELETE /api/explorations/[id]`，僵死任务自动回收。
- **复用**：抽出通用 Claude JSON 调用 `src/lib/analysis/claudeJson.ts`，供分析与探索共用。

### docs: 增加功能使用指南与产品截图 (`ed1c063`)

- 新增 `docs/usage.md`：逐页操作说明、参数与环境变量、AI 引擎说明。
- 补充 13 张产品截图到 `docs/screenshots/`，README 增加预览与入口。

### feat: 同步运行预约与心跳，前端按 runId 轮询 (`2909e63`)

- **运行状态**：`sync_runs` 增加预约与心跳字段，防止重复同步并回收进程崩溃留下的僵死运行。
- **前端**：同步按钮按 runId 轮询状态，刷新页面不会丢失「同步中」状态。`src/components/SyncButton.tsx`

### feat: 初始化 Zodiac coding agent 追踪系统 (`d7ace75`)

- **基础能力**：bare mirror 抓取、提交入库、启发式分类/评级/摘要、按天日报与发版记录；应用内调度器与设置页。
- **功能目录**：13 个模块 / 85 个功能点的功能矩阵，实现对比视图，新功能候选与交叉检查，基线版本与 JSON / Markdown 导出。
- **工程基础**：Next.js 16 + React 19 + SQLite，seed 基线数据，Vitest / Playwright 测试体系。
