import { compileBakeoff } from "../public/bakeoff.js";
import { harvestQueryPlaybook, isLowQualityWalkthrough, isSecondaryWalkthroughHost, canonicalizeHarvestUrl, walkthroughHarvestRules } from "./source-harvest.mjs";

export const DIMENSIONS = [
  { key: "marketFit", label: "市场匹配", weight: 12 },
  { key: "productExperience", label: "产品体验", weight: 14 },
  { key: "aiCapability", label: "AI 能力", weight: 18 },
  { key: "trustSafety", label: "信任安全", weight: 10 },
  { key: "growth", label: "增长", weight: 10 },
  { key: "monetization", label: "商业化", weight: 12 },
  { key: "costEfficiency", label: "成本效率", weight: 10 },
  { key: "ecosystem", label: "生态", weight: 7 },
  { key: "innovation", label: "创新", weight: 7 },
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function safeText(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function safeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function normalizeScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(Math.round(number * 10) / 10, 0, 10) : 0;
}

export function weightedScore(competitor, dimensions = DIMENSIONS) {
  const scores = competitor?.scores || {};
  const sum = dimensions.reduce((total, dimension) => {
    return total + normalizeScore(scores[dimension.key]) * dimension.weight;
  }, 0);
  const weights = dimensions.reduce((total, dimension) => total + dimension.weight, 0);
  return Math.round((sum / weights) * 10) / 10;
}

function normalizeEvidence(item, index) {
  return {
    id: safeText(item?.id, `E${String(index + 1).padStart(2, "0")}`),
    title: safeText(item?.title, "待补充证据"),
    url: safeText(item?.url),
    date: safeText(item?.date),
    type: safeText(item?.type, "公开资料"),
    claim: safeText(item?.claim),
    confidence: ["高", "中", "低"].includes(item?.confidence) ? item.confidence : "中",
  };
}

function normalizeEvidenceList(value) {
  const usedIds = new Set();
  const renamedEvidenceIds = [];
  const evidence = safeArray(value).map((item, index) => {
    const normalized = normalizeEvidence(item, index);
    const requestedId = normalized.id;
    let id = requestedId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${requestedId}-${suffix}`;
      suffix += 1;
    }
    if (id !== requestedId) renamedEvidenceIds.push({ requestedId, normalizedId: id });
    normalized.id = id;
    usedIds.add(id);
    return normalized;
  });
  return { evidence, renamedEvidenceIds };
}

function normalizeEvidenceIds(value, validEvidenceIds, audit, path) {
  const result = [];
  const seen = new Set();
  for (const rawId of safeArray(value)) {
    const id = safeText(String(rawId));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (validEvidenceIds.has(id)) result.push(id);
    else audit.invalidEvidenceReferences.push({ path, evidenceId: id });
  }
  return result;
}

function normalizeScoreRationale(value, validEvidenceIds, audit, path) {
  const source = typeof value === "string" ? { rationale: value } : value || {};
  const evidenceIds = normalizeEvidenceIds(source.evidenceIds, validEvidenceIds, audit, path);
  const requestedConfidence = ["高", "中", "低"].includes(source.confidence) ? source.confidence : "低";
  return {
    rationale: safeText(source.rationale, "待补充评分依据"),
    evidenceIds,
    confidence: evidenceIds.length ? requestedConfidence : "低",
  };
}

function textList(value, limit = 12) {
  return safeArray(value).map((item) => safeText(String(item))).filter(Boolean).slice(0, limit);
}

function normalizeFiveLayers(value = {}) {
  return {
    strategy: safeText(value?.strategy, "待验证"),
    scope: textList(value?.scope),
    structure: textList(value?.structure),
    framework: textList(value?.framework),
    surface: textList(value?.surface),
  };
}

function normalizeMetricSystem(value = {}, fallbackGoal = "待定义") {
  return {
    goal: safeText(value?.goal, fallbackGoal),
    metrics: textList(value?.metrics),
    funnel: textList(value?.funnel),
    gaps: textList(value?.gaps),
  };
}

function normalizeCallouts(item) {
  const existing = safeArray(item?.callouts).map((callout, index) => ({
    n: Math.max(1, Math.round(Number(callout?.n) || index + 1)),
    x: clamp(Number(callout?.x) || 14 + index * 16, 4, 96),
    y: clamp(Number(callout?.y) || 16 + (index % 3) * 24, 6, 92),
    label: safeText(callout?.label, `重点 ${index + 1}`).slice(0, 48),
    insight: safeText(callout?.insight).slice(0, 90),
  })).filter((item) => item.label).slice(0, 6);
  if (existing.length) return existing;
  const parts = String(item?.annotation || "").split(/[；;]|(?:\d+[\.、])/u).map((part) => part.trim()).filter(Boolean).slice(0, 5);
  const positions = [[14, 16], [52, 38], [82, 20], [24, 72], [76, 66]];
  return parts.map((label, index) => ({
    n: index + 1,
    x: positions[index][0],
    y: positions[index][1],
    label: label.slice(0, 40),
    insight: "",
  }));
}

function normalizeSetting(item, index) {
  return {
    name: safeText(item?.name, `设置 ${index + 1}`),
    purpose: safeText(item?.purpose, "待验证"),
    defaultValue: safeText(item?.defaultValue, "待验证"),
    userImpact: safeText(item?.userImpact, "待验证"),
    businessIntent: safeText(item?.businessIntent, "待验证"),
  };
}

function normalizeProductExperience(value = {}, validEvidenceIds, audit) {
  const normalizeVisualResearch = (source = {}) => ({
    status: ["completed", "partial", "failed", "not_started"].includes(source?.status) ? source.status : "not_started",
    capturedAt: safeText(source?.capturedAt),
    sourceUrl: safeText(source?.sourceUrl),
    message: safeText(source?.message),
  });
  const normalizeInterfaceAudit = (item, index, pathPrefix = "productExperience.interfaceAudit") => ({
    screen: safeText(item?.screen, `界面 ${index + 1}`),
    usageStage: safeText(item?.usageStage, "待验证"),
    sourceType: ["actual_app_ui", "official_tutorial", "secondary_walkthrough", "video_walkthrough", "user_supplied", "unverified"].includes(item?.sourceType) ? item.sourceType : "unverified",
    sourceUrl: safeText(item?.sourceUrl),
    videoTimestamp: safeText(item?.videoTimestamp),
    videoSeconds: Math.max(0, Number(item?.videoSeconds) || 0),
    purpose: safeText(item?.purpose, "待验证"),
    entry: safeText(item?.entry, "待验证"),
    primaryAction: safeText(item?.primaryAction, "待验证"),
    feedback: safeText(item?.feedback, "待验证"),
    friction: safeText(item?.friction, "待验证"),
    annotation: safeText(item?.annotation, "待标注"),
    callouts: normalizeCallouts(item),
    imagePath: safeText(item?.imagePath),
    imageUrl: safeText(item?.imageUrl),
    evidenceIds: normalizeEvidenceIds(item?.evidenceIds, validEvidenceIds, audit, `${pathPrefix}[${index}].evidenceIds`),
  });
  const competitorAudits = safeArray(value?.competitorAudits).map((item, competitorIndex) => ({
    competitorName: safeText(item?.competitorName, `竞品 ${competitorIndex + 1}`),
    role: safeText(item?.role, "直接竞品"),
    visualResearch: normalizeVisualResearch(item?.visualResearch),
    designLogic: textList(item?.designLogic),
    interactionLogic: textList(item?.interactionLogic),
    designFocus: safeText(item?.designFocus, "待验证"),
    strengths: textList(item?.strengths, 6),
    weaknesses: textList(item?.weaknesses, 6),
    settings: safeArray(item?.settings).map((setting, index) => normalizeSetting(setting, index)).slice(0, 8),
    interfaceAudit: safeArray(item?.interfaceAudit).map((auditItem, index) => normalizeInterfaceAudit(auditItem, index, `productExperience.competitorAudits[${competitorIndex}].interfaceAudit`)).slice(0, 12),
    docsMap: {
      hubUrl: safeText(item?.docsMap?.hubUrl),
      sourceType: "official_docs",
      platforms: safeArray(item?.docsMap?.platforms).map((platform) => ({
        name: safeText(platform?.name),
        channel: safeText(platform?.channel),
        url: safeText(platform?.url || platform?.href),
        note: safeText(platform?.note || platform?.purpose),
      })).filter((platform) => platform.name).slice(0, 8),
      modules: safeArray(item?.docsMap?.modules).map((module) => ({
        name: safeText(module?.name),
        group: safeText(module?.group),
        href: safeText(module?.href || module?.url),
      })).filter((module) => module.name).slice(0, 40),
      settings: safeArray(item?.docsMap?.settings).map((setting) => ({
        name: safeText(setting?.name),
        purpose: safeText(setting?.purpose || setting?.note),
      })).filter((setting) => setting.name).slice(0, 12),
      notes: textList(item?.docsMap?.notes, 6),
    },
    swimlanes: safeArray(item?.swimlanes).map((lane, index) => ({
      stage: safeText(lane?.stage, `阶段 ${index + 1}`),
      user: safeText(lane?.user, "待定义"),
      frontend: safeText(lane?.frontend, "待定义"),
      agent: safeText(lane?.agent, "待定义"),
      operations: safeText(lane?.operations, "待定义"),
      data: safeText(lane?.data, "待定义"),
    })).slice(0, 8),
    trackingPlan: safeArray(item?.trackingPlan).map((event, index) => ({
      event: safeText(event?.event, `event_${index + 1}`),
      trigger: safeText(event?.trigger, "待定义"),
      properties: textList(event?.properties, 8),
      metric: safeText(event?.metric, "待定义"),
      decision: safeText(event?.decision, "待定义"),
    })).slice(0, 12),
    scenarioValue: {
      bestScene: safeText(item?.scenarioValue?.bestScene, "待验证"),
      summary: safeText(item?.scenarioValue?.summary, "待验证"),
      scenarios: safeArray(item?.scenarioValue?.scenarios).map((scenario, index) => ({
        name: safeText(scenario?.name, `场景 ${index + 1}`),
        fit: clamp(Number(scenario?.fit) || 3, 1, 5),
        work: safeText(scenario?.work, "待验证"),
        why: safeText(scenario?.why, "待验证"),
        evidenceScreen: safeText(scenario?.evidenceScreen, "缺少界面证据"),
        limitation: safeText(scenario?.limitation, "待验证"),
      })).slice(0, 6),
    },
    usabilityScore: {
      total: clamp(Number(item?.usabilityScore?.total) || 0, 0, 5),
      scale: safeText(item?.usabilityScore?.scale, "5 分代表更容易上手、使用成本更低"),
      confidence: {
        level: safeText(item?.usabilityScore?.confidence?.level, "低"),
        covered: Math.max(0, Number(item?.usabilityScore?.confidence?.covered) || 0),
        note: safeText(item?.usabilityScore?.confidence?.note, "证据覆盖不足"),
      },
      verdict: safeText(item?.usabilityScore?.verdict, "待验证"),
      dimensions: safeArray(item?.usabilityScore?.dimensions).map((dimension, index) => ({
        key: safeText(dimension?.key, `dimension_${index + 1}`),
        label: safeText(dimension?.label, `维度 ${index + 1}`),
        score: clamp(Number(dimension?.score) || 3, 1, 5),
        reason: safeText(dimension?.reason, "待验证"),
        evidenceScreen: safeText(dimension?.evidenceScreen, "缺少界面证据"),
      })).slice(0, 8),
      easyPoints: textList(item?.usabilityScore?.easyPoints, 8),
      complexityDrivers: textList(item?.usabilityScore?.complexityDrivers, 8),
    },
    dataModel: {
      principles: textList(item?.dataModel?.principles),
      entities: safeArray(item?.dataModel?.entities).map((entity, index) => ({
        name: safeText(entity?.name, `entity_${index + 1}`),
        purpose: safeText(entity?.purpose, "待定义"),
        keyFields: textList(entity?.keyFields, 10),
        relations: textList(entity?.relations, 8),
        retention: safeText(entity?.retention, "待定义"),
      })).slice(0, 16),
    },
    backendDelivery: {
      summary: safeText(item?.backendDelivery?.summary),
      userStories: textList(item?.backendDelivery?.userStories, 8),
      apis: safeArray(item?.backendDelivery?.apis).map((api, index) => ({
        method: safeText(api?.method, "POST").toUpperCase(),
        path: safeText(api?.path, `/api/resource_${index + 1}`),
        purpose: safeText(api?.purpose, "待定义"),
        payload: safeText(api?.payload, "待定义"),
      })).slice(0, 10),
      jobs: safeArray(item?.backendDelivery?.jobs).map((job, index) => ({
        name: safeText(job?.name, `job_${index + 1}`),
        trigger: safeText(job?.trigger, "待定义"),
        writes: safeText(job?.writes, "待定义"),
      })).slice(0, 8),
      permissions: textList(item?.backendDelivery?.permissions, 8),
      acceptance: textList(item?.backendDelivery?.acceptance, 8),
    },
    fiveLayers: normalizeFiveLayers(item?.fiveLayers),
  })).slice(0, 8);
  const comparisonCells = safeArray(value?.comparison?.cells).map((item) => ({
    dimension: safeText(item?.dimension, "待比较"),
    product: safeText(item?.product, "待指定"),
    focus: safeText(item?.focus, "待验证"),
    note: safeText(item?.note, "待验证"),
  })).slice(0, 40);
  const comparison = {
    dimensions: textList(value?.comparison?.dimensions, 8),
    cells: comparisonCells.length ? comparisonCells : competitorAudits.flatMap((audit) => ([
      { dimension: "入口与信息架构", product: audit.competitorName, focus: audit.designFocus || audit.role, note: audit.designLogic[0] || "待验证" },
      { dimension: "任务编排", product: audit.competitorName, focus: audit.designFocus || audit.role, note: audit.interactionLogic[0] || "待验证" },
      { dimension: "状态与失败恢复", product: audit.competitorName, focus: "交互侧重点", note: audit.interactionLogic[1] || audit.weaknesses[0] || "待验证" },
      { dimension: "结果交付与治理", product: audit.competitorName, focus: audit.designFocus || "待验证", note: audit.strengths[0] || "待验证" },
    ])),
  };
  if (!comparison.dimensions.length) comparison.dimensions = [...new Set(comparison.cells.map((item) => item.dimension))];
  return {
    visualResearch: normalizeVisualResearch(value?.visualResearch),
    designLogic: textList(value?.designLogic),
    interactionLogic: textList(value?.interactionLogic),
    interfaceAudit: safeArray(value?.interfaceAudit).map((item, index) => normalizeInterfaceAudit(item, index)).slice(0, 8),
    competitorAudits,
    comparison,
    swimlanes: safeArray(value?.swimlanes).map((item, index) => ({
      stage: safeText(item?.stage, `阶段 ${index + 1}`),
      user: safeText(item?.user, "待定义"),
      frontend: safeText(item?.frontend, "待定义"),
      agent: safeText(item?.agent, "待定义"),
      operations: safeText(item?.operations, "待定义"),
      data: safeText(item?.data, "待定义"),
    })).slice(0, 8),
    trackingPlan: safeArray(value?.trackingPlan).map((item, index) => ({
      event: safeText(item?.event, `event_${index + 1}`),
      trigger: safeText(item?.trigger, "待定义"),
      properties: textList(item?.properties, 8),
      metric: safeText(item?.metric, "待定义"),
      decision: safeText(item?.decision, "待定义"),
    })).slice(0, 24),
    dataModel: {
      principles: textList(value?.dataModel?.principles),
      entities: safeArray(value?.dataModel?.entities).map((item, index) => ({
        name: safeText(item?.name, `entity_${index + 1}`),
        purpose: safeText(item?.purpose, "待定义"),
        keyFields: textList(item?.keyFields, 10),
        relations: textList(item?.relations, 8),
        retention: safeText(item?.retention, "待定义"),
      })).slice(0, 16),
    },
    backendDelivery: {
      summary: safeText(value?.backendDelivery?.summary, "从界面反推最小可交付实现，待产品与研发共同验收。"),
      userStories: textList(value?.backendDelivery?.userStories, 8),
      apis: safeArray(value?.backendDelivery?.apis).map((item, index) => ({
        method: safeText(item?.method, "POST").toUpperCase(),
        path: safeText(item?.path, `/api/resource_${index + 1}`),
        purpose: safeText(item?.purpose, "待定义"),
        payload: safeText(item?.payload, "待定义"),
      })).slice(0, 10),
      jobs: safeArray(value?.backendDelivery?.jobs).map((item, index) => ({
        name: safeText(item?.name, `job_${index + 1}`),
        trigger: safeText(item?.trigger, "待定义"),
        writes: safeText(item?.writes, "待定义"),
      })).slice(0, 8),
      permissions: textList(value?.backendDelivery?.permissions, 8),
      acceptance: textList(value?.backendDelivery?.acceptance, 8),
    },
    businessFromUi: {
      demand: textList(value?.businessFromUi?.demand, 6),
      monetizationSurfaces: textList(value?.businessFromUi?.monetizationSurfaces, 6),
      costDrivers: textList(value?.businessFromUi?.costDrivers, 6),
      operatingLoops: textList(value?.businessFromUi?.operatingLoops, 6),
      outlook: safeText(value?.businessFromUi?.outlook, "待验证"),
    },
  };
}

function normalizeCompetitor(item, index, validEvidenceIds, audit) {
  const name = safeText(item?.name, `竞品 ${index + 1}`);
  const scores = {};
  const scoreRationales = {};
  for (const dimension of DIMENSIONS) {
    const path = `competitors[${index}].scoreRationales.${dimension.key}`;
    const rationale = normalizeScoreRationale(item?.scoreRationales?.[dimension.key], validEvidenceIds, audit, path);
    const requestedScore = normalizeScore(item?.scores?.[dimension.key]);
    const normalizedScore = rationale.evidenceIds.length || requestedScore <= 5 ? requestedScore : 5;
    if (normalizedScore !== requestedScore) {
      audit.adjustedScores.push({
        competitor: name,
        dimension: dimension.key,
        requestedScore,
        normalizedScore,
        reason: "缺少有效证据引用，评分上限为 5",
      });
    }
    scores[dimension.key] = normalizedScore;
    scoreRationales[dimension.key] = rationale;
  }
  return {
    name,
    url: safeText(item?.url),
    role: safeText(item?.role, index === 0 ? "本品" : "直接竞品"),
    positioning: safeText(item?.positioning, "待验证"),
    pricing: safeText(item?.pricing, "待验证"),
    targetUsers: safeArray(item?.targetUsers).map(String),
    coreJobs: safeArray(item?.coreJobs).map(String),
    businessModel: safeText(item?.businessModel, "待验证"),
    coreJourney: safeArray(item?.coreJourney).map(String),
    strengths: safeArray(item?.strengths).map(String),
    weaknesses: safeArray(item?.weaknesses).map(String),
    opportunities: safeArray(item?.opportunities).map(String),
    threats: safeArray(item?.threats).map(String),
    fiveLayers: normalizeFiveLayers(item?.fiveLayers),
    aiProfile: {
      modelStrategy: safeText(item?.aiProfile?.modelStrategy, "待验证"),
      modalities: safeArray(item?.aiProfile?.modalities).map(String),
      quality: safeText(item?.aiProfile?.quality, "待验证"),
      latency: safeText(item?.aiProfile?.latency, "待验证"),
      reliability: safeText(item?.aiProfile?.reliability, "待验证"),
      privacy: safeText(item?.aiProfile?.privacy, "待验证"),
      dataFlywheel: safeText(item?.aiProfile?.dataFlywheel, "待验证"),
      integration: safeText(item?.aiProfile?.integration, "待验证"),
      cost: safeText(item?.aiProfile?.cost, "待验证"),
    },
    scores,
    scoreRationales,
    score: 0,
  };
}

export function normalizeAnalysis(input = {}) {
  const { evidence, renamedEvidenceIds } = normalizeEvidenceList(input.evidence);
  const validEvidenceIds = new Set(evidence.map((item) => item.id));
  const auditContext = {
    adjustedScores: [],
    adjustedOpportunities: [],
    invalidEvidenceReferences: [],
  };
  const competitors = safeArray(input.competitors).map((item, index) => (
    normalizeCompetitor(item, index, validEvidenceIds, auditContext)
  ));
  competitors.forEach((competitor) => {
    competitor.score = weightedScore(competitor);
  });
  const opportunities = safeArray(input.opportunities).map((item, index) => {
    const evidenceIds = normalizeEvidenceIds(
      item?.evidenceIds,
      validEvidenceIds,
      auditContext,
      `opportunities[${index}].evidenceIds`,
    );
    const requestedConfidence = normalizeScore(item?.confidence);
    const confidence = evidenceIds.length || requestedConfidence <= 5 ? requestedConfidence : 5;
    if (confidence !== requestedConfidence) {
      auditContext.adjustedOpportunities.push({
        opportunity: safeText(item?.title, `机会 ${index + 1}`),
        requestedConfidence,
        normalizedConfidence: confidence,
        reason: "缺少有效证据引用，机会信心上限为 5",
      });
    }
    return {
      title: safeText(item?.title, `机会 ${index + 1}`),
      rationale: safeText(item?.rationale, "待补充"),
      impact: normalizeScore(item?.impact),
      confidence,
      effort: normalizeScore(item?.effort),
      horizon: ["Now", "Next", "Later"].includes(item?.horizon) ? item.horizon : "Next",
      metric: safeText(item?.metric, "待定义"),
      value: safeText(item?.value, "待验证"),
      risk: safeText(item?.risk, "待验证"),
      owner: safeText(item?.owner, "待指定"),
      resources: textList(item?.resources),
      dependencies: textList(item?.dependencies),
      experiment: safeText(item?.experiment, "待设计"),
      successCriteria: safeText(item?.successCriteria, item?.metric ? String(item.metric) : "待定义"),
      nextStep: safeText(item?.nextStep, "待定义"),
      evidenceIds,
    };
  });
  const userNeeds = {
    personas: safeArray(input?.userNeeds?.personas).map((item, index) => ({
      name: safeText(item?.name, `用户类型 ${index + 1}`),
      description: safeText(item?.description, "待验证"),
      goals: textList(item?.goals),
      pains: textList(item?.pains),
      evidenceIds: normalizeEvidenceIds(item?.evidenceIds, validEvidenceIds, auditContext, `userNeeds.personas[${index}].evidenceIds`),
    })),
    scenarios: safeArray(input?.userNeeds?.scenarios).map((item, index) => ({
      name: safeText(item?.name, `场景 ${index + 1}`),
      trigger: safeText(item?.trigger, "待验证"),
      task: safeText(item?.task, "待验证"),
      outcome: safeText(item?.outcome, "待验证"),
      evidenceIds: normalizeEvidenceIds(item?.evidenceIds, validEvidenceIds, auditContext, `userNeeds.scenarios[${index}].evidenceIds`),
    })),
    painPoints: textList(input?.userNeeds?.painPoints),
    kano: {
      mustBe: textList(input?.userNeeds?.kano?.mustBe),
      performance: textList(input?.userNeeds?.kano?.performance),
      delighters: textList(input?.userNeeds?.kano?.delighters),
      indifferent: textList(input?.userNeeds?.kano?.indifferent),
    },
    hmw: textList(input?.userNeeds?.hmw),
  };
  const productExperience = normalizeProductExperience(input?.productExperience, validEvidenceIds, auditContext);
  productExperience.competitorAudits = alignCompetitorAudits(productExperience.competitorAudits, competitors);
  if (!productExperience.interfaceAudit?.length && productExperience.competitorAudits[0]?.interfaceAudit?.length) {
    productExperience.interfaceAudit = productExperience.competitorAudits[0].interfaceAudit.map((item) => ({ ...item }));
  }
  const scoreRationales = competitors.flatMap((competitor) => Object.values(competitor.scoreRationales));
  const supportedScores = scoreRationales.filter((item) => item.evidenceIds.length).length;
  const supportedOpportunities = opportunities.filter((item) => item.evidenceIds.length).length;
  const referencedEvidenceIds = new Set([
    ...scoreRationales.flatMap((item) => item.evidenceIds),
    ...opportunities.flatMap((item) => item.evidenceIds),
    ...userNeeds.personas.flatMap((item) => item.evidenceIds),
    ...userNeeds.scenarios.flatMap((item) => item.evidenceIds),
  ]);
  const priorAudit = ["1.1", "1.2", "1.3"].includes(input.schemaVersion) ? input.audit || {} : {};
  const audit = {
    scoreEvidenceCoverage: scoreRationales.length ? Math.round((supportedScores / scoreRationales.length) * 100) : 0,
    opportunityEvidenceCoverage: opportunities.length ? Math.round((supportedOpportunities / opportunities.length) * 100) : 0,
    adjustedScores: [...safeArray(priorAudit.adjustedScores), ...auditContext.adjustedScores],
    adjustedOpportunities: [...safeArray(priorAudit.adjustedOpportunities), ...auditContext.adjustedOpportunities],
    invalidEvidenceReferences: [...safeArray(priorAudit.invalidEvidenceReferences), ...auditContext.invalidEvidenceReferences],
    renamedEvidenceIds: [...safeArray(priorAudit.renamedEvidenceIds), ...renamedEvidenceIds],
    unreferencedEvidenceIds: evidence.filter((item) => !referencedEvidenceIds.has(item.id)).map((item) => item.id),
  };
  const researchMode = ["web_search", "manual", "demo"].includes(input?.research?.mode) ? input.research.mode : "manual";
  const bakeoff = compileBakeoff({
    competitors,
    userNeeds,
    research: { mode: researchMode },
    productExperience,
    bakeoff: input.bakeoff,
  });
  const limitations = safeArray(input.limitations).map(String);
  if (!bakeoff.scorecard?.ranTaskCount && !limitations.some((item) => /黄金任务|评测集|实测/.test(item))) {
    limitations.push(bakeoff.scorecard?.probedRunCount
      ? "黄金任务网页实测已执行：已打开官方网页版入口。登录墙或仅下载仍标未跑，不能写成交差。"
      : bakeoff.scorecard?.pathRunCount
      ? "黄金任务尚未交差。已用公开网页版、教程或视频核验操作路径；公开路径不能写成交差。"
      : "尚未完成黄金任务交差。开始调研时本地服务会打开官方网页版实测同一条任务；登录墙或仅下载仍标未跑。");
  }
  return {
    schemaVersion: "1.3",
    meta: {
      title: safeText(input?.meta?.title, "AI 产品竞品分析"),
      product: safeText(input?.meta?.product, competitors[0]?.name || "目标产品"),
      objective: safeText(input?.meta?.objective, "识别差异化机会并形成可执行决策"),
      decisionQuestion: safeText(input?.meta?.decisionQuestion, "下一阶段最值得投入的产品机会是什么？"),
      audience: safeText(input?.meta?.audience, "产品与业务负责人"),
      date: safeText(input?.meta?.date, new Date().toISOString().slice(0, 10)),
    },
    executiveSummary: {
      headline: safeText(input?.executiveSummary?.headline, "需要更多证据才能形成可靠判断"),
      verdict: safeText(input?.executiveSummary?.verdict, "优先补齐关键证据并验证核心假设。"),
      insights: safeArray(input?.executiveSummary?.insights).map(String).slice(0, 5),
      actions: safeArray(input?.executiveSummary?.actions).map(String).slice(0, 5),
    },
    research: {
      mode: ["web_search", "manual", "demo"].includes(input?.research?.mode) ? input.research.mode : "manual",
      status: ["completed", "partial", "not_started"].includes(input?.research?.status) ? input.research.status : "not_started",
      searchedAt: safeText(input?.research?.searchedAt),
      searchCalls: Math.max(0, Math.round(Number(input?.research?.searchCalls) || 0)),
      queries: textList(input?.research?.queries),
      scope: textList(input?.research?.scope),
      summary: safeText(input?.research?.summary, "尚未执行联网调研"),
      gaps: textList(input?.research?.gaps),
      ...(input?.research?.webBakeoff && typeof input.research.webBakeoff === "object" ? {
        webBakeoff: {
          ranAt: safeText(input.research.webBakeoff.ranAt),
          taskId: safeText(input.research.webBakeoff.taskId, "T02"),
          skipped: Boolean(input.research.webBakeoff.skipped),
          skipReason: safeText(input.research.webBakeoff.skipReason),
          probes: safeArray(input.research.webBakeoff.probes).slice(0, 8).map((item) => ({
            product: safeText(item?.product),
            kind: safeText(item?.kind),
            url: safeText(item?.url),
            notes: safeText(item?.notes),
          })).filter((item) => item.product),
        },
      } : {}),
    },
    userNeeds,
    productExperience,
    market: {
      stage: safeText(input?.market?.stage, "待判断"),
      trend: safeText(input?.market?.trend, "待判断"),
      sizeSignal: safeText(input?.market?.sizeSignal, "待验证"),
      milestone: safeText(input?.market?.milestone, "待验证"),
      nextInflection: safeText(input?.market?.nextInflection, "待验证"),
      drivers: safeArray(input?.market?.drivers).map(String),
      risks: safeArray(input?.market?.risks).map(String),
      signals: {
        demand: textList(input?.market?.signals?.demand),
        supply: textList(input?.market?.signals?.supply),
        policy: textList(input?.market?.signals?.policy),
        speed: textList(input?.market?.signals?.speed),
      },
    },
    northStar: {
      metric: safeText(input?.northStar?.metric, "有效任务完成数"),
      rationale: safeText(input?.northStar?.rationale, "同时连接用户价值与业务结果"),
      guardrails: safeArray(input?.northStar?.guardrails).map(String),
    },
    dimensions: DIMENSIONS,
    competitors,
    economics: {
      model: safeText(input?.economics?.model, "待验证"),
      acquisition: safeText(input?.economics?.acquisition, "待验证"),
      arpu: safeText(input?.economics?.arpu, "待验证"),
      retention: safeText(input?.economics?.retention, "待验证"),
      efficiencyLevers: safeArray(input?.economics?.efficiencyLevers).map(String),
      pricing: textList(input?.economics?.pricing),
      unitEconomics: textList(input?.economics?.unitEconomics),
    },
    dataSystems: {
      user: normalizeMetricSystem(input?.dataSystems?.user, "衡量核心用户价值"),
      growth: normalizeMetricSystem(input?.dataSystems?.growth, "衡量获客、激活、留存和传播"),
      revenue: normalizeMetricSystem(input?.dataSystems?.revenue, "衡量收入、毛利和单位经济"),
      instrumentation: safeArray(input?.dataSystems?.instrumentation).map((item, index) => ({
        event: safeText(item?.event, `事件 ${index + 1}`),
        purpose: safeText(item?.purpose, "待定义"),
        when: safeText(item?.when, "待定义"),
        where: safeText(item?.where, "待定义"),
        owner: safeText(item?.owner, "待指定"),
        usage: safeText(item?.usage, "待定义"),
      })).slice(0, 20),
    },
    opportunities,
    roadmap: {
      now: safeArray(input?.roadmap?.now).map(String),
      next: safeArray(input?.roadmap?.next).map(String),
      later: safeArray(input?.roadmap?.later).map(String),
    },
    evidence,
    audit,
    bakeoff,
    limitations,
  };
}

const GENERIC_NAME_TOKENS = new Set(["work", "office", "cloud", "agent", "copilot", "platform", "desktop", "app", "pro", "suite", "studio", "assistant", "chat", "ai", "the", "and", "inc", "llc", "for", "new", "工作", "办公", "智能", "助手", "平台", "应用", "企业", "个人"]);

export function namesLikelySame(left, right) {
  const a = String(left || "").toLowerCase().trim();
  const b = String(right || "").toLowerCase().trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const compact = (value) => value.replace(/[^a-z0-9\u4e00-\u9fff]/gu, "");
  const ca = compact(a);
  const cb = compact(b);
  if (ca && ca === cb) return true;
  const shorter = ca.length <= cb.length ? ca : cb;
  const longer = ca.length <= cb.length ? cb : ca;
  if (shorter.length >= 6 && longer.includes(shorter)) return true;
  const tokens = (value) => [...new Set(value.split(/[^a-z0-9\u4e00-\u9fff]+/u).filter((item) => item.length >= 3 && !GENERIC_NAME_TOKENS.has(item)))];
  const leftTokens = tokens(a);
  const rightTokens = tokens(b);
  const overlap = leftTokens.filter((item) => rightTokens.some((other) => {
    if (other === item) return true;
    if (Math.min(item.length, other.length) < 6) return false;
    return other.includes(item) || item.includes(other);
  }));
  return overlap.some((item) => item.length >= 4);
}

function emptyCompetitorAudit(competitor) {
  return {
    competitorName: competitor.name,
    role: competitor.role || "直接竞品",
    visualResearch: { status: "not_started", capturedAt: "", sourceUrl: "", message: "" },
    designLogic: [],
    interactionLogic: [],
    designFocus: "待验证",
    strengths: [],
    weaknesses: [],
    settings: [],
    interfaceAudit: [],
  };
}

export function pinCompetitorsToBrief(analysis, brief) {
  const original = (brief?.competitors || []).filter((item) => String(item?.name || "").trim());
  if (original.length < 2 || !analysis) return analysis;
  const incoming = Array.isArray(analysis.competitors) ? analysis.competitors : [];
  const used = new Set();
  analysis.competitors = original.map((wanted) => {
    let found = incoming.findIndex((item, index) => !used.has(index) && namesLikelySame(item.name, wanted.name));
    if (found < 0) found = incoming.findIndex((item, index) => !used.has(index));
    if (found >= 0) {
      used.add(found);
      return { ...incoming[found], name: wanted.name, url: wanted.url || incoming[found].url, role: wanted.role || incoming[found].role };
    }
    return { name: wanted.name, url: wanted.url || "", role: wanted.role || "直接竞品" };
  });
  analysis.productExperience = analysis.productExperience || {};
  analysis.productExperience.competitorAudits = alignCompetitorAudits(analysis.productExperience.competitorAudits, analysis.competitors);
  return analysis;
}

export function alignCompetitorAudits(audits, competitors) {
  const groups = Array.isArray(audits) ? audits : [];
  const list = (Array.isArray(competitors) ? competitors : []).filter((item) => String(item?.name || "").trim());
  if (!list.length) return groups;
  const used = new Set();
  return list.map((competitor) => {
    let found = groups.findIndex((item, index) => !used.has(index) && String(item.competitorName || "") === competitor.name);
    if (found < 0) found = groups.findIndex((item, index) => !used.has(index) && namesLikelySame(item.competitorName, competitor.name));
    if (found >= 0) {
      used.add(found);
      return { ...groups[found], competitorName: competitor.name, role: competitor.role || groups[found].role };
    }
    return emptyCompetitorAudit(competitor);
  });
}

export function applyHarvestUiEvidence(analysis, harvest) {
  const items = Array.isArray(harvest?.uiEvidence) ? harvest.uiEvidence : [];
  if (!analysis || !items.length) return analysis;
  const px = analysis.productExperience || (analysis.productExperience = {});
  const audits = Array.isArray(px.competitorAudits) ? px.competitorAudits : (px.competitorAudits = []);
  for (const item of items) {
    const key = String(item.productName || "").trim();
    if (!key || !item.sourceUrl || isLowQualityWalkthrough(item.sourceUrl)) continue;
    let group = audits.find((entry) => namesLikelySame(entry.competitorName, key));
    if (!group) {
      const competitor = (analysis.competitors || []).find((entry) => namesLikelySame(entry.name, key));
      group = {
        competitorName: competitor?.name || item.productName,
        role: competitor?.role || "直接竞品",
        designLogic: [],
        interactionLogic: [],
        designFocus: "待验证",
        strengths: [],
        weaknesses: [],
        settings: [],
        interfaceAudit: [],
      };
      audits.push(group);
    }
    const screens = Array.isArray(group.interfaceAudit) ? group.interfaceAudit : (group.interfaceAudit = []);
    const sourceUrl = canonicalizeHarvestUrl(item.sourceUrl) || item.sourceUrl;
    if (screens.some((screen) => (canonicalizeHarvestUrl(screen.sourceUrl) || screen.sourceUrl) === sourceUrl && screen.screen === item.screen)) continue;
    const harvestedType = String(item.sourceType || "").trim();
    screens.push({
      screen: item.screen || "应用界面",
      usageStage: item.usageStage || "待验证",
      sourceType: isSecondaryWalkthroughHost(sourceUrl)
        ? "secondary_walkthrough"
        : (/bilibili\.com|youtu\.be|youtube\.com/iu.test(sourceUrl) ? "video_walkthrough" : (harvestedType || "web_keyword")),
      sourceUrl,
      imageUrl: item.imageUrl || "",
      videoTimestamp: item.videoTimestamp || "",
      videoSeconds: item.videoSeconds || 0,
      purpose: item.claim || "待验证",
      entry: "待验证",
      primaryAction: "待验证",
      feedback: "待验证",
      friction: "待验证",
      annotation: item.claim || "待标注",
      callouts: [],
      evidenceIds: [],
    });
  }
  return analysis;
}

export function buildEvidenceHarvestPrompt(brief) {
  const compact = JSON.stringify({
    meta: brief?.meta,
    competitors: brief?.competitors,
    autoDiscover: brief?.autoDiscover,
    evidenceNotes: brief?.evidenceNotes,
  }, null, 2).slice(0, 20000);
  const names = [
    brief?.meta?.product,
    ...(Array.isArray(brief?.competitors) ? brief.competitors.map((item) => item?.name) : []),
  ].filter(Boolean);
  return `你是竞品调研检索员。只负责搜索并核对公开来源，不要写完整七层分析报告。

使用 web_search。${harvestQueryPlaybook(names)}
1. 先全网关键词搜索（界面/工作台/控制台 + 截图/screenshot/UI，以及教程/walkthrough），不要只搜官网。命中网页写入 uiEvidence 后，由后续步骤打开页面、判定页内图片是否为应用 UI，通过才下载。
2. 再打开官方文档站/学习中心/开发者门户侧栏、hash 内页、courses。形态参考 https://www.workbuddy.cn/docs/workbuddy/Overview、https://aecore.glodon.com/docs/aecore/guide_1_preview.html#%E6%88%90%E4%B8%BA%E5%BC%80%E5%8F%91%E8%80%85、https://learnacc.autodesk.com/page/courses。联盟追踪参数必须去掉。
3. ${walkthroughHarvestRules()}
4. 每个产品最多 4 条 UI 证据。uiEvidence.productName 必须等于用户填写的产品名；禁止因为名称里都有 Cloud/Work/办公 就把多款产品写成同一个。官网首页、SEM 页、下载页、Logo、宣传 KV、带 cjdata/AID 的落地页不算 uiEvidence。优先功能说明 / 工作台或项目主页 / 执行 / 结果 / 设置这类子页。
5. ${brief?.autoDiscover === false ? "只检索用户指定对象，不新增竞品。" : "直接竞品不足时最多再补 2 次搜索。"}
6. 每条证据必须有真实 URL；搜不到就写入 gaps，禁止编造链接、价格或市场份额。
7. 搜完立即输出可 JSON.parse 的对象，不要 Markdown，不要继续搜索。

JSON 结构：
{
  "queries": [""],
  "summary": "",
  "gaps": [""],
  "competitors": [{"name":"","url":"","role":"本品/直接竞品/间接竞品/标杆","positioning":"","pricing":"","notes":""}],
  "uiEvidence": [{"productName":"","screen":"","usageStage":"进入/发起/执行/交付/治理","sourceType":"official_tutorial/secondary_walkthrough/video_walkthrough/web_keyword","sourceUrl":"关键词命中页、官方文档或视频 URL","imageUrl":"页内原始截图 URL（仅当图通过 UI 判定时填写）","videoTimestamp":"视频证据填写 mm:ss","videoSeconds":0,"claim":"该界面证明什么"}],
  "evidence": [{"id":"E01","title":"","url":"","date":"YYYY-MM-DD","type":"官网/定价/文档/更新日志/行业资料","claim":"","confidence":"高/中/低"}]
}

用户任务：
${compact}`;
}

export function buildAnalysisPrompt(brief) {
  const compact = JSON.stringify(brief, null, 2).slice(0, 70000);
  return `你是“AI 产品竞品分析 Agent”。请基于用户材料和已核实的公开资料完成结构化分析，并只输出 JSON 对象。

调研模式：${brief?.autoResearch === false ? "仅使用用户材料，不联网" : "必须联网搜索并核对公开资料"}
竞品发现：${brief?.autoDiscover === false ? "只分析用户指定对象" : "若用户未提供足够竞品，自动发现 3 个直接竞品和 1 个间接竞品/标杆"}

方法必须依次覆盖：
1. 用户与需求：核心用户、任务场景、Kano 层级、HMW 机会。
2. 行业：需求/供给/政策/速度四指标，Gartner 阶段，规模、里程碑、下一转折。
3. 前端产品审计：对本品及每一个竞品分别分析真实使用过程。competitorAudits 必须与用户填写的产品一一对应，competitorName 必须等于 competitors.name，禁止因为名称里都有 Work/办公/Agent 就把多款产品写成同一个。每个产品优先覆盖「进入工作台/发起任务/执行与状态/结果交付/权限或后台」中的至少 3 个阶段，并在 callouts 里按 Anygen 方式给截图编号（侧栏、模式、输入、设置、结果）。没有应用内界面证据时明确写待验证，禁止只分析本品。
4. 产品与交互：总结信息架构、渐进披露、默认值、状态反馈、错误恢复、权限提示和跨端连续性；输出用户泳道，覆盖用户/前端/Agent/运营/数据五方。
5. 数据与实现：给出可执行埋点字典，事件名使用 snake_case；说明触发条件、关键属性、指标和产品决策；推导最小数据库实体、关系、留存与审计逻辑。
6. 竞品五层必须能从界面读出来，禁止把结构层/框架层/表现层写成「待验证」：
   - 战略层：这款产品靠什么差异化赚钱或获客。
   - 范围层：界面里真正做了哪些任务对象（任务、技能、工作空间、引用等）。
   - 结构层（信息架构）：侧栏模块、页面层级、任务/会话/项目对象流，必须引用 interfaceAudit 的屏名与 callouts。
   - 框架层（界面骨架与交互）：布局分区（侧栏/输入/监控/预览）、模式切换、权限/工作空间控件、状态反馈。
   - 表现层（视觉与控件组织）：工作台密度、零状态卡片、文件胶囊、引用标记等截图上看得见的东西，禁止用官网 KV 代替。
7. AI 专项：模型策略、模态、效果、时延、可靠性、隐私安全、数据飞轮、集成与成本。
8. 数据：用户、增长、营收三大系统；提出北极星指标与护栏指标。
9. 商业：变现模式、访问/ARPU/回访三级火箭、LTV/CAC 与效率杠杆。
10. 黄金任务对照表：为所有分析对象建立同一份工作评测集（5–8 个任务）。不要下载或安装竞品客户端。不要编造网页实测结果。联网时为每个任务检索官方网页版/教程/视频，写入 runs.publicPath；模型填写的 status 必须是 not_run、source 必须是 unrun。公开路径不是交差。本地服务会在每次开始调研时打开官方网页版实测 T02（带来源研究）；登录墙或仅下载仍标未跑，来源由本地工具写成 measured。只有用户材料里已有交差记录时，模型才可以把 source 写成 measured。这张表不能被九维评分替代。
11. 汇报：结论先行，每条建议写清价值、证据、风险、资源与下一步。

证据纪律：
- 不得编造数据、用户反馈、价格、融资或市场规模。
- 官网首页、产品宣传页、价格页、发布会画面、概念插画不得作为 interfaceAudit 的应用内 UI 证据；它们只能支持定位或商业结论。
- interfaceAudit 只接受真实软件工作台、任务配置、执行状态、结果交付、权限提示、失败恢复、设置或管理后台截图。每屏必须填写 usageStage、sourceType、sourceUrl；官方教程中的真实应用截图标为 official_tutorial，可信实操文章标为 secondary_walkthrough，无法核验标为 unverified 且不得伪装成已完成证据。
- 若图文来源没有真实界面，可降级检索产品官方演示或可信的 YouTube／Bilibili 实操教程，从视频中截取能清楚看到应用内操作的画面，标为 video_walkthrough，并填写 videoTimestamp 和 videoSeconds。视频封面、口播人物、发布会、广告和无操作上下文的宣传片段不得计入证据。
- 只有用户材料或已打开核实的公开网页明确支持的事实才写成确定事实；其余写“待验证”。
- 联网模式下优先逐个核对目标产品与竞品的官网、定价页、产品/帮助文档、更新日志，再补充可信行业来源。
- evidence 每条包含 title/url/date/type/claim/confidence。联网获得的证据必须填写真实 URL；无法确认发布日期时 date 写访问日期。
- 所有 evidence 先分配唯一 ID；scoreRationales 和 opportunities.evidenceIds 只能引用这些 ID，不得杜撰引用。
- 评分为 0-10，缺少有效 evidenceIds 的维度不得高于 5；每个竞品九维评分及九维评分依据必须齐全。
- 机会项必须引用证据；缺少有效 evidenceIds 时 confidence 不得高于 5。
- 搜索结果不充分时，把缺口写入 research.gaps 和 limitations，不要用常识补造。
- 输出必须能被 JSON.parse 直接解析：不要 Markdown、不要注释、不要尾逗号。
- 字符串内如需引号，使用中文「」或转义为 \\"；数组元素之间必须有逗号。
- 每个文本数组最多 6 项，scoreRationales 每条 rationale 不超过 40 字，输出尽量紧凑。

严格按以下 JSON 结构输出，不要 Markdown：
{
  "meta":{"title":"","product":"","objective":"","decisionQuestion":"","audience":"","date":"YYYY-MM-DD"},
  "executiveSummary":{"headline":"","verdict":"","insights":[""],"actions":[""]},
  "research":{"mode":"web_search/manual","status":"completed/partial","searchedAt":"ISO-8601","queries":[""],"scope":[""],"summary":"","gaps":[""]},
  "userNeeds":{
    "personas":[{"name":"","description":"","goals":[""],"pains":[""],"evidenceIds":["E01"]}],
    "scenarios":[{"name":"","trigger":"","task":"","outcome":"","evidenceIds":["E01"]}],
    "painPoints":[""],
    "kano":{"mustBe":[""],"performance":[""],"delighters":[""],"indifferent":[""]},
    "hmw":[""]
  },
  "productExperience":{
    "designLogic":["产品设计原则或信息架构判断"],
    "interactionLogic":["关键交互、状态反馈与错误恢复判断"],
    "interfaceAudit":[{"screen":"界面名称","usageStage":"进入/配置/执行/交付/治理","sourceType":"actual_app_ui/official_tutorial/secondary_walkthrough/video_walkthrough/user_supplied/unverified","sourceUrl":"截图或视频所在页面 URL","videoTimestamp":"视频证据填写 mm:ss","videoSeconds":0,"purpose":"用户目的","entry":"入口","primaryAction":"主操作","feedback":"系统反馈","friction":"摩擦点","annotation":"截图上应标注的重点","callouts":[{"n":1,"x":12,"y":18,"label":"标注短句","insight":"为何重要"}],"evidenceIds":["E01"]}],
    "competitorAudits":[{"competitorName":"必须与 competitors.name 完全一致","role":"本品/直接竞品/间接竞品/标杆","designFocus":"该产品界面设置的侧重点","designLogic":["该产品的信息架构判断"],"interactionLogic":["该产品的交互判断"],"strengths":["界面优点"],"weaknesses":["界面短板"],"settings":[{"name":"设置项","purpose":"作用","defaultValue":"默认","userImpact":"对用户","businessIntent":"商业意图"}],"interfaceAudit":[{"screen":"该产品实际应用界面","usageStage":"进入/配置/执行/交付/治理","sourceType":"official_tutorial","sourceUrl":"","purpose":"","entry":"","primaryAction":"","feedback":"","friction":"","annotation":"","callouts":[{"n":1,"x":20,"y":20,"label":"重点","insight":""}],"evidenceIds":["E01"]}]}],
    "comparison":{"dimensions":["入口与信息架构","任务编排","状态与失败恢复","结果交付与治理"],"cells":[{"dimension":"入口与信息架构","product":"产品名","focus":"侧重点","note":"一句话对比"}]},
    "swimlanes":[{"stage":"阶段","user":"用户动作","frontend":"前端状态与反馈","agent":"Agent/模型动作","operations":"运营或管理员动作","data":"写入或读取的数据"}],
    "trackingPlan":[{"event":"snake_case_event","trigger":"触发条件","properties":["property_name"],"metric":"影响指标","decision":"用于什么产品决策"}],
    "dataModel":{"principles":["数据建模原则"],"entities":[{"name":"entity_name","purpose":"实体用途","keyFields":["id","status"],"relations":["belongs_to workspace"],"retention":"留存与审计要求"}]},
    "backendDelivery":{"summary":"给后端的最小实现口径","userStories":["作为用户我可以…"],"apis":[{"method":"POST","path":"/api/tasks","purpose":"创建任务","payload":"goal,workspace_id"}],"jobs":[{"name":"run_task","trigger":"task.created","writes":"task_run,artifact"}],"permissions":["workspace.admin 可改权限"],"acceptance":["失败可恢复且可审计"]},
    "businessFromUi":{"demand":["界面暴露的需求"],"monetizationSurfaces":["额度/席位/升级入口"],"costDrivers":["长任务、重试、存储"],"operatingLoops":["失败归因、模板分发"],"outlook":"个人工具到企业平台的路径"}
  },
  "market":{"stage":"","trend":"","sizeSignal":"","milestone":"","nextInflection":"","drivers":[""],"risks":[""],"signals":{"demand":[""],"supply":[""],"policy":[""],"speed":[""]}},
  "northStar":{"metric":"","rationale":"","guardrails":[""]},
  "competitors":[{
    "name":"","url":"","role":"本品/直接竞品/间接竞品/标杆","positioning":"","pricing":"",
    "targetUsers":[""],"coreJobs":[""],"businessModel":"","coreJourney":[""],
    "strengths":[""],"weaknesses":[""],"opportunities":[""],"threats":[""],
    "fiveLayers":{"strategy":"","scope":[""],"structure":[""],"framework":[""],"surface":[""]},
    "aiProfile":{"modelStrategy":"","modalities":[""],"quality":"","latency":"","reliability":"","privacy":"","dataFlywheel":"","integration":"","cost":""},
    "scores":{"marketFit":0,"productExperience":0,"aiCapability":0,"trustSafety":0,"growth":0,"monetization":0,"costEfficiency":0,"ecosystem":0,"innovation":0},
    "scoreRationales":{
      "marketFit":{"rationale":"","evidenceIds":["E01"],"confidence":"高/中/低"},
      "productExperience":{"rationale":"","evidenceIds":["E01"],"confidence":"高/中/低"},
      "aiCapability":{"rationale":"","evidenceIds":["E01"],"confidence":"高/中/低"},
      "trustSafety":{"rationale":"","evidenceIds":["E01"],"confidence":"高/中/低"},
      "growth":{"rationale":"","evidenceIds":["E01"],"confidence":"高/中/低"},
      "monetization":{"rationale":"","evidenceIds":["E01"],"confidence":"高/中/低"},
      "costEfficiency":{"rationale":"","evidenceIds":["E01"],"confidence":"高/中/低"},
      "ecosystem":{"rationale":"","evidenceIds":["E01"],"confidence":"高/中/低"},
      "innovation":{"rationale":"","evidenceIds":["E01"],"confidence":"高/中/低"}
    }
  }],
  "economics":{"model":"","acquisition":"","arpu":"","retention":"","efficiencyLevers":[""],"pricing":[""],"unitEconomics":[""]},
  "dataSystems":{
    "user":{"goal":"","metrics":[""],"funnel":[""],"gaps":[""]},
    "growth":{"goal":"","metrics":[""],"funnel":[""],"gaps":[""]},
    "revenue":{"goal":"","metrics":[""],"funnel":[""],"gaps":[""]},
    "instrumentation":[{"event":"","purpose":"","when":"","where":"","owner":"","usage":""}]
  },
  "opportunities":[{"title":"","rationale":"","value":"","risk":"","impact":0,"confidence":0,"effort":0,"horizon":"Now/Next/Later","metric":"","owner":"","resources":[""],"dependencies":[""],"experiment":"","successCriteria":"","nextStep":"","evidenceIds":["E01"]}],
  "roadmap":{"now":[""],"next":[""],"later":[""]},
  "evidence":[{"id":"E01","title":"","url":"","date":"","type":"","claim":"","confidence":"高/中/低"}],
  "bakeoff":{"method":"同一份工作对照，调研时打开网页版实测","protocol":[""],"tasks":[{"id":"T01","name":"","job":"","materials":"同一份材料","success":"交差标准","runs":[{"product":"必须与 competitors.name 一致","status":"not_run/passed/partial/failed","source":"unrun/measured","publicPath":{"channel":"none/official_web/official_tutorial/video_walkthrough/secondary_walkthrough","url":"","stagesSeen":["进入","执行","交付"],"notes":"未见公开操作路径"},"completed":null,"interventions":null,"timeToValueMinutes":null,"deliverableUsable":null,"recoveredFromFailure":"not_run/yes/no/not_applicable","cost":"未记录","notes":"未跑","evidenceIds":[]}]}]},
  "limitations":[""]
}

用户材料：
${compact}`;
}

function demoScoreRationales(prefix, evidenceByDimension) {
  return Object.fromEntries(DIMENSIONS.map((dimension) => [dimension.key, {
    rationale: `${prefix}；${dimension.label}评分来自对应演示证据。`,
    evidenceIds: evidenceByDimension[dimension.key] || [],
    confidence: "中",
  }]));
}

export const DEMO_ANALYSIS = normalizeAnalysis({
  meta: {
    title: "AI 知识助手竞品分析（演示数据）",
    product: "Atlas AI",
    objective: "确定下一季度差异化产品投入",
    decisionQuestion: "应优先提升模型能力、工作流还是企业信任？",
    audience: "产品委员会",
    date: "2026-08-27",
  },
  executiveSummary: {
    headline: "工作流闭环与可验证答案，比单纯追逐模型参数更能形成差异化",
    verdict: "优先建设可追溯答案、团队知识连接和任务闭环；模型能力采用多模型路由。",
    insights: [
      "直接竞品在通用问答上已高度同质化，竞争重心转向上下文与工作流。",
      "企业用户的核心阻力来自权限、来源可追溯和稳定性，而非功能数量。",
      "Atlas AI 的成本效率较好，但生态与增长分发仍弱。",
    ],
    actions: [
      "8 周内上线来源级引用与答案置信度",
      "选择两个高频部门工作流完成端到端闭环",
      "建立任务成功率、7 日留存和单任务毛利的联合指标",
    ],
  },
  research: {
    mode: "demo",
    status: "completed",
    searchedAt: "2026-08-27T10:00:00+08:00",
    searchCalls: 8,
    queries: ["企业 AI 知识助手", "AI 助手定价与治理", "AI 研究工具引用能力"],
    scope: ["产品官网", "定价与帮助文档", "演示用访谈与产品数据"],
    summary: "演示数据覆盖产品定位、AI 能力、商业模式、企业信任和工作流闭环。",
    gaps: ["缺少真实市场规模", "缺少同一测试集的横向实测"],
  },
  userNeeds: {
    personas: [
      {name:"知识团队负责人",description:"需要团队可复用且可审计的 AI 工作流",goals:["提升研究和汇报效率","控制事实与权限风险"],pains:["答案来源不清","跨系统资料分散"],evidenceIds:["E01","E02"]},
      {name:"一线研究人员",description:"高频完成跨资料研究和长文交付",goals:["减少检索整理时间","快速形成可复核报告"],pains:["重复搬运资料","长任务容易中断"],evidenceIds:["E02","E03"]},
    ],
    scenarios: [
      {name:"跨资料决策研究",trigger:"接到新市场或竞品研究任务",task:"检索、核对、综合并形成汇报材料",outcome:"输出带来源的可决策结论",evidenceIds:["E01","E03"]},
      {name:"部门知识复用",trigger:"相似任务反复出现",task:"复用模板、知识库和审批规则",outcome:"降低交付成本并稳定质量",evidenceIds:["E02","E05"]},
    ],
    painPoints: ["来源不可追溯", "权限与隐私边界不清", "通用问答无法闭环业务任务"],
    kano: {mustBe:["权限控制","可靠引用"],performance:["任务成功率","响应速度"],delighters:["部门工作流自动闭环"],indifferent:["堆叠低频写作模板"]},
    hmw: ["我们如何让每个答案都能快速回到来源？", "我们如何把一次性问答变成团队可复用的工作流？"],
  },
  productExperience: {
    designLogic: ["先连接知识再发起任务", "用证据侧栏而不是纯聊天窗交付"],
    interactionLogic: ["任务有排队/运行/失败/恢复", "导出前必须看到引用来源"],
    competitorAudits: [{
      competitorName: "Atlas AI",
      role: "本品",
      designFocus: "可信任务闭环，而不是通用问答",
      designLogic: ["工作台以任务为中心", "证据与交付物并排"],
      interactionLogic: ["发起后立即回显范围", "失败可一键重试"],
      visualResearch: { status: "completed", sourceUrl: "https://example.com/atlas-workspace", message: "演示用工作台示意图，用于展示标注、对比和后端倒推；不是真实产品截图。" },
      strengths: ["状态可见", "来源可点回"],
      weaknesses: ["连接器入口弱"],
      settings: [{ name: "引用开关", purpose: "强制来源级引用", defaultValue: "开", userImpact: "降低幻觉审阅成本", businessIntent: "支撑企业采购门槛" }],
      interfaceAudit: [{
        screen: "任务工作台", usageStage: "执行", sourceType: "user_supplied", sourceUrl: "https://example.com/atlas-workspace",
        imageUrl: "/assets/demo-workspace.png",
        purpose: "发起并监控研究任务", entry: "左侧任务列表", primaryAction: "运行任务", feedback: "进度条与阶段标签", friction: "连接器配置入口偏深",
        annotation: "1. 任务列表；2. 证据侧栏；3. 交付预览",
        callouts: [
          { n: 1, x: 14, y: 22, label: "任务列表", insight: "以任务而非会话作为主对象" },
          { n: 2, x: 58, y: 40, label: "证据侧栏", insight: "每条结论必须能点回来源" },
          { n: 3, x: 82, y: 70, label: "交付预览", insight: "导出前完成验收" },
        ],
        evidenceIds: ["E02"],
      }],
    }, {
      competitorName: "Nova Copilot",
      role: "直接竞品",
      designFocus: "办公套件内的随手唤起，而不是独立任务对象",
      designLogic: ["能力挂在文档和会议入口", "侧边栏优先于工作台"],
      interactionLogic: ["生成后内联插入", "失败主要表现为重新提问"],
      strengths: ["分发入口多"],
      weaknesses: ["缺少可恢复的长任务状态"],
      settings: [{ name: "企业数据范围", purpose: "限制可检索的租户内容", defaultValue: "当前租户", userImpact: "降低越权风险", businessIntent: "支撑企业采购" }],
      interfaceAudit: [{
        screen: "套件侧边栏", usageStage: "进入", sourceType: "unverified",
        purpose: "在文档中唤起助手", entry: "办公套件侧栏", primaryAction: "输入提示并生成", feedback: "流式文本插入文档", friction: "没有独立任务对象和失败恢复",
        annotation: "入口在既有办公套件内，演示数据未提供可核验截图",
      }],
    }, {
      competitorName: "Quill Research",
      role: "间接竞品",
      designFocus: "研究进度与来源列表，而不是团队协作",
      designLogic: ["先定义问题再检索", "来源列表与长报告并排"],
      interactionLogic: ["长任务以报告草稿推进", "引用必须随段落出现"],
      strengths: ["引用密度高"],
      weaknesses: ["协作与权限弱"],
      interfaceAudit: [{
        screen: "研究报告页", usageStage: "交付", sourceType: "unverified",
        purpose: "审阅带来源的长报告", entry: "研究任务完成后的报告阅读页", primaryAction: "核对引用并导出", feedback: "段落旁显示来源标记", friction: "团队复用和权限治理不足",
        annotation: "研究交付页强调来源，演示数据未提供可核验截图",
      }],
    }],
    swimlanes: [
      { stage: "发起", user: "描述目标和资料范围", frontend: "回显范围与预计消耗", agent: "生成执行计划", operations: "可选模板", data: "写入 task" },
      { stage: "执行", user: "观察阶段并补充约束", frontend: "排队/运行/失败状态", agent: "检索与综合", operations: "失败告警", data: "写入 task_run" },
      { stage: "交付", user: "审阅引用并导出", frontend: "预览/修订/复跑", agent: "按引用重写", operations: "质量抽检", data: "写入 artifact" },
    ],
    trackingPlan: [
      { event: "task_created", trigger: "用户确认目标并提交", properties: ["workspace_id", "source_count"], metric: "任务发起率", decision: "判断激活是否发生" },
      { event: "task_failed", trigger: "执行失败或超时", properties: ["error_code", "retry_count"], metric: "失败可恢复率", decision: "决定重试策略" },
    ],
    dataModel: {
      principles: ["按租户隔离", "任务与产物可审计", "失败可回放"],
      entities: [{ name: "task", purpose: "一次可验收的研究任务", keyFields: ["task_id", "status", "workspace_id"], relations: ["has_many task_run"], retention: "企业版保留 365 天" }],
    },
    backendDelivery: {
      summary: "先交付可恢复的任务对象，再做连接器和导出。",
      userStories: ["作为研究员，我可以发起带资料范围的任务并看到阶段"],
      apis: [{ method: "POST", path: "/api/tasks", purpose: "创建任务", payload: "goal, workspace_id, source_ids" }],
      jobs: [{ name: "run_task", trigger: "task.created", writes: "task_run, artifact" }],
      permissions: ["workspace.member 可创建任务", "workspace.admin 可看审计"],
      acceptance: ["失败后可重试且保留原输入"],
    },
    businessFromUi: {
      demand: ["可追溯答案", "任务闭环"],
      monetizationSurfaces: ["席位", "任务用量"],
      costDrivers: ["长任务", "重试", "文档解析"],
      operatingLoops: ["失败归因", "模板分发"],
      outlook: "从个人研究助手升级为团队可审计工作台",
    },
  },
  market: {
    stage: "应用爆发期向增长泡沫期过渡",
    trend: "基础模型能力快速扩散，企业采购转向可控、可集成和可衡量",
    sizeSignal: "演示数据：未接入真实市场规模",
    milestone: "检索增强与 Agent 工作流成为标配",
    nextInflection: "可审计 Agent 与业务系统原生集成",
    drivers: ["模型成本下降", "企业知识孤岛", "智能体工具调用成熟"],
    risks: ["同质化", "幻觉与合规", "推理成本波动"],
    signals: {
      demand:["企业采购从试用转向可衡量的任务价值"],
      supply:["基础模型和通用问答能力快速扩散"],
      policy:["数据权限、审计和内容责任要求提高"],
      speed:["Agent 工具调用和连接器供给加速"],
    },
  },
  northStar: {
    metric: "每周成功完成的高价值任务数",
    rationale: "同时反映激活、使用深度和真实用户价值",
    guardrails: ["引用准确率", "P95 响应时间", "单任务毛利", "严重安全事件数"],
  },
  competitors: [
    {
      name: "Atlas AI", role: "本品", positioning: "面向知识团队的可信任务助手",
      targetUsers: ["产品", "研究", "销售运营"], coreJobs: ["跨资料研究", "生成决策材料"],
      businessModel: "席位订阅 + 用量", coreJourney: ["连接知识", "提出任务", "审阅证据", "导出交付物"],
      strengths: ["成本效率", "证据组织"], weaknesses: ["生态较弱", "品牌认知低"],
      fiveLayers: {strategy:"可信任务助手，以结果交付而非通用问答建立差异",scope:["知识连接","来源级引用","报告导出"],structure:["连接知识 → 定义任务 → 执行 → 审阅 → 导出"],framework:["任务工作台","证据侧栏","交付物预览"],surface:["克制的专业工具视觉","用置信度和状态强化可控感"]},
      aiProfile: {modelStrategy:"多模型路由", modalities:["文本","文档"], quality:"复杂任务较稳", latency:"中等", reliability:"有重试与降级", privacy:"租户隔离", dataFlywheel:"任务反馈", integration:"基础连接器", cost:"按任务优化"},
      scores: {marketFit:7.2,productExperience:7.1,aiCapability:7.5,trustSafety:7.8,growth:5.6,monetization:6.5,costEfficiency:8.2,ecosystem:5.3,innovation:7.4},
      scoreRationales: demoScoreRationales("Atlas AI 的访谈、产品数据、评测与经营台账形成交叉验证", {
        marketFit:["E01","E02"], productExperience:["E01","E02"], aiCapability:["E03"], trustSafety:["E01","E03"],
        growth:["E02"], monetization:["E04"], costEfficiency:["E04"], ecosystem:["E05"], innovation:["E06"],
      }),
    },
    {
      name: "Nova Copilot", role: "直接竞品", positioning: "通用办公 AI 副驾驶",
      targetUsers: ["广泛知识工作者"], coreJobs: ["问答", "写作", "办公协同"],
      businessModel: "席位订阅", coreJourney: ["进入办公套件", "唤起助手", "生成内容", "协作"],
      strengths: ["分发", "生态"], weaknesses: ["深度工作流有限", "成本不透明"],
      fiveLayers: {strategy:"依托办公套件覆盖广泛知识工作",scope:["办公问答","内容生成","会议协作"],structure:["在既有办公入口唤起并完成局部任务"],framework:["侧边栏助手","文档内联生成","跨应用入口"],surface:["延续办公套件品牌和交互规范"]},
      aiProfile: {modelStrategy:"自研主模型", modalities:["文本","图像","语音"], quality:"通用能力强", latency:"较快", reliability:"企业级", privacy:"企业控制", dataFlywheel:"办公行为", integration:"原生套件", cost:"高固定席位费"},
      scores: {marketFit:8.1,productExperience:8.0,aiCapability:8.5,trustSafety:8.2,growth:8.9,monetization:8.2,costEfficiency:6.2,ecosystem:9.2,innovation:7.8},
      scoreRationales: demoScoreRationales("Nova Copilot 的演示产品核对与商业基准支持其分发和生态优势", {
        marketFit:["E07","E08"], productExperience:["E07"], aiCapability:["E07"], trustSafety:["E07"],
        growth:["E08"], monetization:["E08"], costEfficiency:["E08"], ecosystem:["E07"], innovation:["E07"],
      }),
    },
    {
      name: "Quill Research", role: "间接竞品", positioning: "专业研究与报告生成器",
      targetUsers: ["咨询", "研究人员"], coreJobs: ["资料检索", "长报告"],
      businessModel: "订阅 + 点数", coreJourney: ["定义问题", "联网检索", "生成报告", "引用导出"],
      strengths: ["研究体验", "引用"], weaknesses: ["协作弱", "通用任务窄"],
      fiveLayers: {strategy:"聚焦深度研究和长报告交付",scope:["联网检索","研究规划","引用报告"],structure:["定义问题 → 搜索 → 综合 → 报告"],framework:["研究进度","来源列表","长报告阅读"],surface:["内容优先的研究工具风格"]},
      aiProfile: {modelStrategy:"外部模型聚合", modalities:["文本","网页"], quality:"研究任务强", latency:"较慢", reliability:"来源回退", privacy:"基础隐私", dataFlywheel:"研究模板", integration:"导出为主", cost:"按深度消耗"},
      scores: {marketFit:7.7,productExperience:7.8,aiCapability:7.2,trustSafety:7.0,growth:6.8,monetization:6.7,costEfficiency:6.5,ecosystem:5.8,innovation:7.6},
      scoreRationales: demoScoreRationales("Quill Research 的功能核对与任务测试支持其研究链路判断", {
        marketFit:["E09","E10"], productExperience:["E09","E10"], aiCapability:["E09"], trustSafety:["E09"],
        growth:["E10"], monetization:["E10"], costEfficiency:["E10"], ecosystem:["E09"], innovation:["E09"],
      }),
    },
  ],
  economics: {
    model: "订阅 + 用量",
    acquisition: "内容与团队试用",
    arpu: "通过部门工作流和治理能力提升",
    retention: "以知识连接和任务模板形成复用",
    efficiencyLevers: ["高频模板拉新", "任务成功率提升 ARPU", "团队资产促进回访"],
    pricing: ["席位订阅", "高级治理包", "超额任务用量"],
    unitEconomics: ["跟踪单成功任务推理成本", "用团队复用摊薄知识接入成本", "验证 LTV/CAC > 3"],
  },
  dataSystems: {
    user: {goal:"衡量是否真正完成高价值任务",metrics:["任务成功率","结果采纳率","引用准确率"],funnel:["创建任务","完成任务","审阅通过","导出/分享"],gaps:["缺少跨部门统一任务分类"]},
    growth: {goal:"衡量从个人试用到团队扩散",metrics:["激活率","7 日留存","团队邀请率","模板复用率"],funnel:["访问","连接首个来源","完成首个任务","邀请同事"],gaps:["渠道归因不完整"]},
    revenue: {goal:"衡量任务价值与毛利是否同步增长",metrics:["付费转化","ARPU","单任务毛利","LTV/CAC"],funnel:["试用","个人付费","团队升级","扩席"],gaps:["团队版价格敏感度待验证"]},
    instrumentation: [
      {event:"task_completed",purpose:"计算任务成功与完成时长",when:"任务达到可交付状态",where:"任务工作台",owner:"数据产品",usage:"北极星与留存分析"},
      {event:"citation_verified",purpose:"衡量引用准确性和审阅成本",when:"用户确认或驳回来源",where:"证据侧栏",owner:"AI 产品",usage:"质量评测与模型路由"},
    ],
  },
  opportunities: [
    {title:"可验证答案层",rationale:"解决企业信任阻力",value:"提升采购通过率和结果采纳",risk:"引用形式完整但内容仍可能误配",impact:9,confidence:8,effort:5,horizon:"Now",metric:"引用准确率 / 任务采纳率",owner:"AI 产品",resources:["评测集","引用组件"],dependencies:["检索服务"],experiment:"在两个研究任务中对比有无引用审阅耗时",successCriteria:"引用准确率≥95%，审阅时间下降30%",nextStep:"建立 100 条来源级评测集",evidenceIds:["E01","E03"]},
    {title:"部门工作流包",rationale:"从工具升级为结果交付",value:"提高使用深度和团队留存",risk:"过早定制导致场景碎片化",impact:8.5,confidence:7.5,effort:6.5,horizon:"Now",metric:"成功任务数 / 7日留存",owner:"工作流产品",resources:["场景设计","客户成功"],dependencies:["权限模板"],experiment:"为产品和销售运营各上线一个模板",successCriteria:"模板用户 7 日留存提升20%",nextStep:"选择两个高频部门共创",evidenceIds:["E01","E02"]},
    {title:"连接器生态",rationale:"增强数据可达与迁移成本",value:"扩大可完成任务边界",risk:"维护成本和权限复杂度上升",impact:8,confidence:7,effort:8,horizon:"Next",metric:"活跃连接器数",owner:"平台产品",resources:["连接器 SDK","安全评审"],dependencies:["统一权限层"],experiment:"验证三个最高频知识源",successCriteria:"连接器激活后成功任务提升15%",nextStep:"按需求频次排序连接器",evidenceIds:["E05","E07"]},
    {title:"开放 Agent 市场",rationale:"扩大长尾场景供给",value:"形成第三方供给和分成",risk:"质量治理和冷启动难度高",impact:7,confidence:5.5,effort:9,horizon:"Later",metric:"月活 Agent 数",owner:"生态负责人",resources:["开发者平台","审核机制"],dependencies:["稳定 SDK","商业分成"],experiment:"邀请 10 个设计伙伴内测",successCriteria:"至少 3 个 Agent 周活超过 100",nextStep:"先验证内部模板市场",evidenceIds:["E05","E06"]},
  ],
  roadmap: {
    now: ["补齐来源级引用与评测集", "完成两个部门工作流闭环"],
    next: ["扩展治理与连接器", "验证团队版定价"],
    later: ["开放第三方 Agent", "形成生态分成"],
  },
  evidence: [
    {id:"E01",title:"演示用产品访谈摘要",date:"2026-08-20",type:"内部访谈",claim:"企业用户把可追溯列为采购门槛",confidence:"中"},
    {id:"E02",title:"演示用产品数据",date:"2026-08-25",type:"产品数据",claim:"完成端到端任务的用户 7 日留存更高",confidence:"中"},
    {id:"E03",title:"演示用 AI 质量评测",date:"2026-08-24",type:"离线评测",claim:"来源级引用能降低复杂任务的审阅成本",confidence:"中"},
    {id:"E04",title:"演示用单位经济台账",date:"2026-08-23",type:"经营数据",claim:"多模型路由改善单任务成本，但团队版定价仍待验证",confidence:"中"},
    {id:"E05",title:"演示用连接器盘点",date:"2026-08-22",type:"产品盘点",claim:"Atlas 的原生连接器覆盖弱于办公套件型竞品",confidence:"中"},
    {id:"E06",title:"演示用概念测试",date:"2026-08-21",type:"概念测试",claim:"用户愿意尝试可复用的部门工作流与第三方 Agent",confidence:"低"},
    {id:"E07",title:"演示用 Nova 产品核对",date:"2026-08-19",type:"产品核对",claim:"Nova 在办公入口、模态和企业控制上覆盖较完整",confidence:"中"},
    {id:"E08",title:"演示用 Nova 商业基准",date:"2026-08-18",type:"商业分析",claim:"套件分发和席位订阅带来增长优势，固定席位成本影响效率",confidence:"中"},
    {id:"E09",title:"演示用 Quill 功能核对",date:"2026-08-17",type:"产品核对",claim:"Quill 的联网研究、引用与长报告链路较完整，但集成较少",confidence:"中"},
    {id:"E10",title:"演示用研究任务测试",date:"2026-08-16",type:"任务测试",claim:"Quill 在深度研究任务上体验较好，协作与通用场景较弱",confidence:"中"},
  ],
  bakeoff: {
    tasks: [
      {
        id: "T01",
        name: "本地文件整理并产出可编辑交付物",
        job: "把同一组本地资料整理成可打开、可继续改的文档或幻灯片",
        materials: "同一组本地文件和同一条任务说明",
        success: "产物可打开、可编辑，并覆盖事先写好的要点",
        runs: [
          { product: "Atlas AI", status: "not_run", source: "unrun", notes: "未跑", publicPath: { channel: "official_tutorial", url: "https://example.com/atlas-workspace", stagesSeen: ["进入", "执行", "交付"], notes: "官方工作台教程能看到上传到导出，不是本机实测" }, evidenceIds: ["E02"] },
        ],
      },
      {
        id: "T02",
        name: "根据公开网页完成带来源的研究或对比",
        job: "用同一组公开链接做研究或竞品对比，并交代来源",
        materials: "同一组研究问题和同一批公开网页",
        success: "结论能点回具体来源，且不是只复述功能清单",
        runs: [
          { product: "Atlas AI", status: "passed", source: "measured", completed: true, interventions: 1, timeToValueMinutes: 22, deliverableUsable: true, recoveredFromFailure: "not_applicable", cost: "演示记录", notes: "演示评测：导出前能点回来源", evidenceIds: ["E03"], publicPath: { channel: "official_tutorial", url: "https://example.com/atlas-workspace", stagesSeen: ["执行", "交付"], notes: "工作台教程同时展示研究任务" } },
          { product: "Nova Copilot", status: "partial", source: "measured", completed: false, interventions: 4, timeToValueMinutes: 9, deliverableUsable: false, recoveredFromFailure: "no", cost: "演示记录", notes: "演示评测：能生成草稿，引用不完整，失败后只能重问", evidenceIds: ["E03"] },
          { product: "Quill Research", status: "passed", source: "measured", completed: true, interventions: 2, timeToValueMinutes: 31, deliverableUsable: true, recoveredFromFailure: "not_applicable", cost: "演示记录", notes: "演示评测：长报告带来源，但协作复用弱", evidenceIds: ["E10"] },
        ],
      },
    ],
  },
  limitations: ["全部竞品名称和数据均为演示用途，不代表真实公司或市场结论。"],
});
