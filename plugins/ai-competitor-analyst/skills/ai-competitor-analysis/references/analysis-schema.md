# 分析 JSON 结构

HTML 看板接受 UTF-8 JSON。顶层字段：

- `meta`: `title/product/objective/decisionQuestion/audience/date`
- `executiveSummary`: `headline/verdict/insights[]/actions[]`
- `research`: `mode/status/searchedAt/searchCalls/queries[]/scope[]/summary/gaps[]`
- `userNeeds`: `personas[]/scenarios[]/painPoints[]/kano/hmw[]`
- `market`: `stage/trend/sizeSignal/milestone/nextInflection/drivers[]/risks[]/signals`
- `northStar`: `metric/rationale/guardrails[]`
- `competitors[]`: 基础定位、用户、任务、定价、商业、核心链路、SWOT、`fiveLayers`、`aiProfile`、`scores`
- `economics`: `model/acquisition/arpu/retention/efficiencyLevers[]/pricing[]/unitEconomics[]`
- `dataSystems`: `user/growth/revenue/instrumentation[]`
- `opportunities[]`: `title/rationale/value/risk/impact/confidence/effort/horizon/metric/owner/resources[]/dependencies[]/experiment/successCriteria/nextStep/evidenceIds[]`
- `roadmap`: `now[]/next[]/later[]`
- `evidence[]`: `id/title/url/date/type/claim/confidence`
- `bakeoff`: 黄金任务对照表。`tasks[]` 含 `id/name/job/materials/success/runs[]`。每个 run 含 `product/status/source/publicPath/completed/interventions/timeToValueMinutes/deliverableUsable/recoveredFromFailure/cost/notes/evidenceIds[]`。`publicPath` 记录不装软件也能打开的公开操作路径（`channel`: `none|official_web|official_tutorial|video_walkthrough|secondary_walkthrough`，以及 `url/stagesSeen/notes`）。`status` 为 `not_run|passed|partial|failed`。`source=measured` 且 `status=not_run` 表示本地服务已经打开过官方网页版，但停在登录墙、仅下载或打开失败，格子仍是未跑。有公开路径也不能写成 `passed`。首页和功能清单不算交差。`scorecard` 由本地工具汇总。`research.webBakeoff` 记录每次调研时的网页探测结果。模型不得编造 measured 结果。
- `limitations[]`
- `audit`: 本地工具生成的证据覆盖、自动降级、无效引用和未引用证据审计；模型不要自行填写

`scores` 必须包含九个 0-10 数值：

```json
{
  "marketFit": 0,
  "productExperience": 0,
  "aiCapability": 0,
  "trustSafety": 0,
  "growth": 0,
  "monetization": 0,
  "costEfficiency": 0,
  "ecosystem": 0,
  "innovation": 0
}
```

`fiveLayers` 包含 `strategy/scope[]/structure[]/framework[]/surface[]`。`aiProfile` 包含 `modelStrategy/modalities[]/quality/latency/reliability/privacy/dataFlywheel/integration/cost`。无法证实的字段使用“待验证”，不要删除字段或补造内容。

`dataSystems.user/growth/revenue` 各包含 `goal/metrics[]/funnel[]/gaps[]`。`instrumentation[]` 的每个事件包含 `event/purpose/when/where/owner/usage`。

每个竞品还必须包含与九维键完全一致的 `scoreRationales`。每一项包含 `rationale/evidenceIds[]/confidence`：

```json
{
  "scoreRationales": {
    "marketFit": {
      "rationale": "目标用户访谈和任务完成数据共同支持该判断",
      "evidenceIds": ["E01", "E02"],
      "confidence": "中"
    }
  }
}
```

`evidenceIds` 只能引用顶层 `evidence[]` 已存在的唯一 ID。工具会移除无效引用，把没有有效证据的维度评分和机会信心限制在 5，并把调整写入 `audit`。当前结构版本为 `1.3`。
