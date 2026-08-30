import test from "node:test";
import assert from "node:assert/strict";
import { applyHarvestUiEvidence, buildAnalysisPrompt, buildEvidenceHarvestPrompt, DEMO_ANALYSIS, DIMENSIONS, namesLikelySame, normalizeAnalysis, pinCompetitorsToBrief, weightedScore } from "../server/analysis.mjs";

test("normalizes scores and preserves the full nine-dimension model", () => {
  const result = normalizeAnalysis({
    evidence: [{ id: "E01", title: "测试证据" }],
    competitors: [{
      name: "A",
      scores: { marketFit: 12, aiCapability: -2, productExperience: 7.26 },
      scoreRationales: { marketFit: { rationale: "有依据", evidenceIds: ["E01"], confidence: "高" } },
    }],
  });
  assert.equal(Object.keys(result.competitors[0].scores).length, DIMENSIONS.length);
  assert.equal(result.competitors[0].scores.marketFit, 10);
  assert.equal(result.competitors[0].scores.aiCapability, 0);
  assert.equal(result.competitors[0].scores.productExperience, 5);
  assert.equal(result.competitors[0].positioning, "待验证");
  assert.equal(result.competitors[0].scoreRationales.marketFit.confidence, "高");
  assert.equal(result.audit.adjustedScores.length, 1);
});

test("computes a bounded weighted score", () => {
  const allEight = { scores: Object.fromEntries(DIMENSIONS.map((item) => [item.key, 8])) };
  assert.equal(weightedScore(allEight), 8);
});

test("prompt enforces evidence discipline and JSON output", () => {
  const prompt = buildAnalysisPrompt({ meta: { product: "Example" }, autoResearch: true, autoDiscover: true });
  assert.match(prompt, /只输出 JSON/);
  assert.match(prompt, /不得编造数据/);
  assert.match(prompt, /九维/);
  assert.match(prompt, /scoreRationales/);
  assert.match(prompt, /evidenceIds/);
  assert.match(prompt, /联网/);
  assert.match(prompt, /userNeeds/);
  assert.match(prompt, /fiveLayers/);
  assert.match(prompt, /结构层（信息架构）/);
  assert.match(prompt, /框架层（界面骨架与交互）/);
  assert.match(prompt, /表现层（视觉与控件组织）/);
  assert.match(prompt, /dataSystems/);
  assert.match(prompt, /productExperience/);
  assert.match(prompt, /用户泳道/);
  assert.match(prompt, /数据库实体/);
  assert.match(prompt, /官网首页、产品宣传页、价格页/);
  assert.match(prompt, /usageStage/);
  assert.match(prompt, /sourceType/);
  assert.match(prompt, /YouTube／Bilibili/);
  assert.match(prompt, /videoTimestamp/);
  assert.match(prompt, /Example/);
});

test("harvest prompt stays compact and forbids fabricating URLs", () => {
  const prompt = buildEvidenceHarvestPrompt({ meta: { product: "Autodesk ACC" }, autoDiscover: true });
  assert.match(prompt, /不要写完整七层分析/);
  assert.match(prompt, /禁止编造链接/);
  assert.match(prompt, /最多 \d+ 次/);
  assert.match(prompt, /uiEvidence/);
  assert.match(prompt, /Autodesk ACC/);
  assert.match(prompt, /workbuddy.cn\/docs/);
  assert.match(prompt, /知乎/);
  assert.match(prompt, /优设/);
  assert.match(prompt, /全网关键词/);
  assert.match(prompt, /应用 UI/);
  assert.match(prompt, /aecore.glodon.com/);
  assert.match(prompt, /secondary_walkthrough/);
  assert.ok(prompt.length < 12000);
});

test("preserves schema 1.3 product experience and executable opportunity fields", () => {
  const result = normalizeAnalysis({
    userNeeds: {
      personas: [{ name: "研究员", goals: ["快速核验"], evidenceIds: [] }],
      kano: { mustBe: ["真实来源"] },
    },
    competitors: [{ name: "A", fiveLayers: { strategy: "可信研究", scope: ["联网检索"] } }],
    dataSystems: { user: { metrics: ["任务成功率"] }, instrumentation: [{ event: "task_completed", owner: "产品" }] },
    productExperience: {
      designLogic: ["自然语言入口"],
      competitorAudits: [{
        competitorName: "A",
        role: "本品",
        designFocus: "任务入口",
        designLogic: ["任务入口"],
        interfaceAudit: [{
          screen: "任务工作台",
          usageStage: "执行",
          sourceType: "official_tutorial",
          sourceUrl: "https://docs.example.com/task",
          imageUrl: "/generated/ui/a.png",
          annotation: "任务列表；证据侧栏",
        }],
      }],
      backendDelivery: { apis: [{ method: "POST", path: "/api/tasks", purpose: "创建任务" }] },
      businessFromUi: { outlook: "从助手升级为工作台" },
      interfaceAudit: [{ screen: "任务页", primaryAction: "发起任务" }],
      swimlanes: [{ stage: "发起", user: "描述目标", frontend: "确认范围" }],
      trackingPlan: [{ event: "task_created", metric: "任务发起率" }],
      dataModel: { entities: [{ name: "task", keyFields: ["task_id"] }] },
    },
    opportunities: [{ title: "来源核验", value: "提升信任", owner: "AI 产品", experiment: "小流量测试", successCriteria: "准确率≥95%" }],
  });
  assert.equal(result.schemaVersion, "1.3");
  assert.equal(result.userNeeds.personas[0].name, "研究员");
  assert.equal(result.userNeeds.kano.mustBe[0], "真实来源");
  assert.equal(result.competitors[0].fiveLayers.strategy, "可信研究");
  assert.equal(result.dataSystems.user.metrics[0], "任务成功率");
  assert.equal(result.dataSystems.instrumentation[0].event, "task_completed");
  assert.equal(result.productExperience.interfaceAudit[0].screen, "任务页");
  assert.equal(result.productExperience.competitorAudits[0].competitorName, "A");
  assert.equal(result.productExperience.competitorAudits[0].interfaceAudit[0].imageUrl, "/generated/ui/a.png");
  assert.equal(result.productExperience.competitorAudits[0].interfaceAudit[0].usageStage, "执行");
  assert.equal(result.productExperience.competitorAudits[0].interfaceAudit[0].sourceType, "official_tutorial");
  assert.equal(result.productExperience.swimlanes[0].frontend, "确认范围");
  assert.equal(result.productExperience.trackingPlan[0].event, "task_created");
  assert.equal(result.productExperience.dataModel.entities[0].name, "task");
  assert.equal(result.productExperience.competitorAudits[0].designFocus, "任务入口");
  assert.equal(result.productExperience.backendDelivery.apis[0].path, "/api/tasks");
  assert.equal(result.productExperience.businessFromUi.outlook, "从助手升级为工作台");
  assert.ok(result.productExperience.comparison.cells.length > 0);
  assert.ok(result.productExperience.competitorAudits[0].interfaceAudit[0].callouts.length >= 1);
  assert.equal(result.opportunities[0].owner, "AI 产品");
  assert.equal(result.opportunities[0].successCriteria, "准确率≥95%");
});

test("audits invalid evidence references and bounds unsupported confidence", () => {
  const result = normalizeAnalysis({
    evidence: [{ id: "E01", title: "唯一来源" }, { id: "E01", title: "重复来源" }],
    competitors: [{
      name: "A",
      scores: { trustSafety: 8 },
      scoreRationales: { trustSafety: { rationale: "引用不存在", evidenceIds: ["E99"] } },
    }],
    opportunities: [
      { title: "有证据机会", confidence: 8, evidenceIds: ["E01"] },
      { title: "无证据机会", confidence: 9, evidenceIds: ["E99"] },
    ],
  });
  assert.deepEqual(result.evidence.map((item) => item.id), ["E01", "E01-2"]);
  assert.equal(result.competitors[0].scores.trustSafety, 5);
  assert.equal(result.opportunities[0].confidence, 8);
  assert.equal(result.opportunities[1].confidence, 5);
  assert.equal(result.audit.invalidEvidenceReferences.length, 2);
  assert.equal(result.audit.renamedEvidenceIds.length, 1);
  assert.equal(result.audit.adjustedOpportunities.length, 1);
});

test("preserves video walkthrough evidence and timestamp metadata", () => {
  const result = normalizeAnalysis({
    productExperience: {
      competitorAudits: [{
        competitorName: "A",
        interfaceAudit: [{
          screen: "任务执行",
          usageStage: "执行",
          sourceType: "video_walkthrough",
          sourceUrl: "https://www.youtube.com/watch?v=example",
          videoTimestamp: "02:15",
          videoSeconds: 135,
        }],
      }],
    },
  });
  const audit = result.productExperience.competitorAudits[0].interfaceAudit[0];
  assert.equal(audit.sourceType, "video_walkthrough");
  assert.equal(audit.videoTimestamp, "02:15");
  assert.equal(audit.videoSeconds, 135);
});

test("merges harvested UI sources into competitor audits before screenshot capture", () => {
  const analysis = applyHarvestUiEvidence(normalizeAnalysis({
    competitors: [{ name: "Autodesk ACC", role: "本品" }],
  }), {
    uiEvidence: [{
      productName: "Autodesk ACC",
      screen: "项目工作台",
      usageStage: "进入",
      sourceType: "official_tutorial",
      sourceUrl: "https://help.autodesk.com/docs/start",
      claim: "从项目列表进入工作台",
    }],
  });
  assert.equal(analysis.productExperience.competitorAudits[0].competitorName, "Autodesk ACC");
  assert.equal(analysis.productExperience.competitorAudits[0].interfaceAudit[0].sourceUrl, "https://help.autodesk.com/docs/start");
  assert.match(analysis.productExperience.competitorAudits[0].interfaceAudit[0].annotation, /工作台/);
});

test("keeps Zhihu crossover articles as secondary walkthroughs", () => {
  const analysis = applyHarvestUiEvidence(normalizeAnalysis({
    competitors: [{ name: "WorkBuddy", role: "本品" }],
  }), {
    uiEvidence: [{
      productName: "WorkBuddy",
      screen: "教师工作台场景",
      usageStage: "执行",
      sourceType: "official_tutorial",
      sourceUrl: "https://zhuanlan.zhihu.com/p/2072617646596608260",
      claim: "个人工作台在教学场景中的任务流程",
    }],
  });
  assert.equal(analysis.productExperience.competitorAudits[0].interfaceAudit[0].sourceType, "secondary_walkthrough");
  assert.equal(analysis.productExperience.competitorAudits[0].interfaceAudit[0].sourceUrl, "https://zhuanlan.zhihu.com/p/2072617646596608260");
});

test("matches harvested UI sources even when product names are not identical", () => {
  assert.equal(namesLikelySame("Autodesk ACC", "Autodesk Construction Cloud"), true);
  const analysis = applyHarvestUiEvidence(normalizeAnalysis({
    competitors: [{ name: "Autodesk ACC", role: "本品" }],
  }), {
    uiEvidence: [{
      productName: "Autodesk Construction Cloud",
      screen: "项目工作台",
      sourceType: "official_tutorial",
      sourceUrl: "https://help.autodesk.com/view/DOCS/ENU/",
      claim: "官方帮助中心工作台",
    }],
  });
  assert.equal(analysis.productExperience.competitorAudits[0].interfaceAudit[0].sourceUrl, "https://help.autodesk.com/view/DOCS/ENU/");
});

test("does not collapse office agents that only share the word Work", () => {
  assert.equal(namesLikelySame("Trae Work", "腾讯 WorkBuddy"), false);
  assert.equal(namesLikelySame("Trae Work", "QwenWork (千问办公)"), false);
  assert.equal(namesLikelySame("Trae Work", "豆包工作 (Doubao Work)"), false);
  assert.equal(namesLikelySame("Trae Work", "Microsoft 365 Copilot"), false);
  assert.equal(namesLikelySame("Trae Work", "TraeWork"), true);
  assert.equal(namesLikelySame("腾讯 WorkBuddy", "WorkBuddy"), true);
  const result = normalizeAnalysis({
    competitors: [
      { name: "腾讯 WorkBuddy", role: "本品" },
      { name: "Trae Work", role: "直接竞品" },
      { name: "QwenWork (千问办公)", role: "直接竞品" },
      { name: "豆包工作 (Doubao Work)", role: "直接竞品" },
      { name: "Microsoft 365 Copilot", role: "间接竞品/标杆" },
    ],
    productExperience: {
      competitorAudits: [
        { competitorName: "Trae Work", role: "直接竞品", interfaceAudit: [{ screen: "官网", sourceUrl: "https://www.trae.cn/sem-work" }] },
        { competitorName: "Trae Work", role: "直接竞品", interfaceAudit: [{ screen: "官网2", sourceUrl: "https://www.trae.cn/" }] },
      ],
    },
  });
  assert.deepEqual(result.productExperience.competitorAudits.map((item) => item.competitorName), [
    "腾讯 WorkBuddy", "Trae Work", "QwenWork (千问办公)", "豆包工作 (Doubao Work)", "Microsoft 365 Copilot",
  ]);
  assert.equal(result.productExperience.competitorAudits[0].interfaceAudit.length, 0);
  assert.equal(result.productExperience.competitorAudits[1].competitorName, "Trae Work");
});

test("pins analysis products back to the user-specified competitor set", () => {
  const pinned = pinCompetitorsToBrief(normalizeAnalysis({
    competitors: [
      { name: "Trae Work", role: "直接竞品" },
      { name: "Trae Work", role: "直接竞品" },
      { name: "Trae Work", role: "直接竞品" },
    ],
    productExperience: {
      competitorAudits: [
        { competitorName: "Trae Work", role: "直接竞品" },
        { competitorName: "Trae Work", role: "直接竞品" },
        { competitorName: "Trae Work", role: "直接竞品" },
      ],
    },
  }), {
    competitors: [
      { name: "腾讯 WorkBuddy", role: "本品" },
      { name: "Trae Work", role: "直接竞品" },
      { name: "QwenWork (千问办公)", role: "直接竞品" },
    ],
  });
  assert.deepEqual(pinned.competitors.map((item) => `${item.name}|${item.role}`), [
    "腾讯 WorkBuddy|本品",
    "Trae Work|直接竞品",
    "QwenWork (千问办公)|直接竞品",
  ]);
  assert.deepEqual(pinned.productExperience.competitorAudits.map((item) => item.competitorName), [
    "腾讯 WorkBuddy", "Trae Work", "QwenWork (千问办公)",
  ]);
});

test("demo analysis is internally complete", () => {
  assert.equal(DEMO_ANALYSIS.schemaVersion, "1.3");
  assert.equal(DEMO_ANALYSIS.research.status, "completed");
  assert.ok(DEMO_ANALYSIS.userNeeds.personas.length >= 1);
  assert.ok(DEMO_ANALYSIS.dataSystems.instrumentation.length >= 1);
  assert.ok(DEMO_ANALYSIS.competitors.length >= 3);
  assert.ok(DEMO_ANALYSIS.opportunities.length >= 3);
  assert.ok(DEMO_ANALYSIS.evidence.length >= 1);
  for (const competitor of DEMO_ANALYSIS.competitors) {
    assert.equal(Object.keys(competitor.scores).length, 9);
    assert.equal(Object.keys(competitor.scoreRationales).length, 9);
    assert.ok(competitor.fiveLayers.strategy);
    assert.ok(competitor.score >= 0 && competitor.score <= 10);
  }
  assert.equal(DEMO_ANALYSIS.audit.scoreEvidenceCoverage, 100);
  assert.equal(DEMO_ANALYSIS.audit.opportunityEvidenceCoverage, 100);
  assert.equal(DEMO_ANALYSIS.audit.adjustedScores.length, 0);
  assert.ok(DEMO_ANALYSIS.productExperience.competitorAudits[0].interfaceAudit[0].callouts.length >= 1);
  assert.equal(DEMO_ANALYSIS.productExperience.competitorAudits[0].interfaceAudit[0].imageUrl, "/assets/demo-workspace.png");
  assert.ok(DEMO_ANALYSIS.productExperience.backendDelivery.apis.length >= 1);
  assert.ok(DEMO_ANALYSIS.productExperience.comparison.cells.length >= 1);
});
