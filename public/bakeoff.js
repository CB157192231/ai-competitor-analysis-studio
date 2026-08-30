const STATUSES = ["not_run", "passed", "partial", "failed"];
const SOURCES = ["unrun", "measured", "inferred"];
const RECOVERIES = ["not_run", "yes", "no", "not_applicable"];
const INFERRED_CLAIM_RE = /具备此能力|支持该任务|可以完成|能够完成|官网显示|功能清单|理应|应该能|宣传称/u;
const PLACEHOLDER_RE = /^(待验证|待补充|待定义|未记录|未跑|)$/u;

export const BAKEOFF_METRICS = ["是否交差", "人工介入次数", "首次可用结果(分钟)", "产物能否直接用", "失败后能否继续", "本次费用"];

export const DEFAULT_GOLDEN_TASKS = [
  {
    id: "T01",
    name: "本地文件整理并产出可编辑交付物",
    job: "把同一组本地资料整理成可打开、可继续改的文档或幻灯片",
    materials: "同一组本地文件和同一条任务说明",
    success: "产物可打开、可编辑，并覆盖事先写好的要点",
  },
  {
    id: "T02",
    name: "根据公开网页完成带来源的研究或对比",
    job: "用同一组公开链接做研究或竞品对比，并交代来源",
    materials: "同一组 URL 和同一条决策问题",
    success: "结论能点回具体来源，且不是只复述官网功能清单",
  },
  {
    id: "T03",
    name: "使用岗位技能或专家套件完成该角色的典型交付",
    job: "安装或调用对应岗位能力后，完成该岗位的一份标准产出",
    materials: "同一岗位场景和同一份输入材料",
    success: "产出符合该岗位交付物形态，而不是通用闲聊回复",
  },
  {
    id: "T04",
    name: "连接外部系统并把结果写回",
    job: "接到指定外部应用后，把结果写回该系统或导出为可回写对象",
    materials: "同一个目标系统和同一条写入要求",
    success: "外部系统或导出文件中能看到本次任务的结果",
  },
  {
    id: "T05",
    name: "任务失败后停止、重试或续跑",
    job: "在同一类失败点上，看用户能否停止、看清原因并继续",
    materials: "同一条会失败或中断的任务",
    success: "失败原因可见，并且能重试、续跑或明确放弃",
  },
];

function compactName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/gu, "");
}

export function namesMatch(left, right) {
  const a = compactName(left);
  const b = compactName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 6 && longer.includes(shorter);
}

function text(value, fallback = "") {
  const next = String(value ?? "").trim();
  return next || fallback;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableBoolean(value) {
  if (value === true || value === false) return value;
  if (value === "true" || value === "yes" || value === "是") return true;
  if (value === "false" || value === "no" || value === "否") return false;
  return null;
}

export function emptyRun(product) {
  return {
    product,
    status: "not_run",
    source: "unrun",
    completed: null,
    interventions: null,
    timeToValueMinutes: null,
    deliverableUsable: null,
    recoveredFromFailure: "not_run",
    cost: "未记录",
    notes: "未跑",
    evidenceIds: [],
  };
}

export function normalizeRun(run, product, researchMode = "manual") {
  const base = emptyRun(product);
  const incoming = run && typeof run === "object" ? run : {};
  let status = STATUSES.includes(incoming.status) ? incoming.status : "not_run";
  let source = SOURCES.includes(incoming.source) ? incoming.source : (status === "not_run" ? "unrun" : "inferred");
  const notes = text(incoming.notes, status === "not_run" ? "未跑" : "");
  const evidenceIds = Array.isArray(incoming.evidenceIds) ? incoming.evidenceIds.map((item) => String(item || "").trim()).filter(Boolean) : [];
  const looksInferred = source === "inferred"
    || INFERRED_CLAIM_RE.test(notes)
    || (status !== "not_run" && PLACEHOLDER_RE.test(notes) && !evidenceIds.length);
  if (status !== "not_run" && researchMode !== "demo") {
    if (source !== "measured" || (looksInferred && !evidenceIds.length)) return emptyRun(product);
  }
  if (status === "not_run") {
    return { ...base, notes: notes && !PLACEHOLDER_RE.test(notes) ? notes : "未跑", evidenceIds };
  }
  return {
    product,
    status,
    source: researchMode === "demo" ? "measured" : source,
    completed: nullableBoolean(incoming.completed),
    interventions: nullableNumber(incoming.interventions),
    timeToValueMinutes: nullableNumber(incoming.timeToValueMinutes),
    deliverableUsable: nullableBoolean(incoming.deliverableUsable),
    recoveredFromFailure: RECOVERIES.includes(incoming.recoveredFromFailure) ? incoming.recoveredFromFailure : "not_run",
    cost: text(incoming.cost, "未记录"),
    notes: notes || "实测记录不完整",
    evidenceIds,
  };
}

function findRun(runs, product) {
  return (runs || []).find((item) => namesMatch(item?.product, product));
}

function taskKey(task) {
  return compactName(task?.id || task?.name);
}

function mergeTaskDefinition(base, extra = {}) {
  return {
    id: text(extra.id, base.id),
    name: text(extra.name, base.name),
    job: text(extra.job, base.job),
    materials: text(extra.materials, base.materials),
    success: text(extra.success, base.success),
  };
}

export function proposeGoldenTasks(analysis = {}) {
  const proposed = DEFAULT_GOLDEN_TASKS.map((item) => ({ ...item }));
  const scenarios = Array.isArray(analysis?.userNeeds?.scenarios) ? analysis.userNeeds.scenarios : [];
  for (const scenario of scenarios.slice(0, 3)) {
    const name = text(scenario?.name);
    if (!name) continue;
    const exists = proposed.some((item) => compactName(item.name).includes(compactName(name)) || compactName(name).includes(compactName(item.name)));
    if (exists) continue;
    proposed.push({
      id: `S${String(proposed.length + 1).padStart(2, "0")}`,
      name,
      job: text(scenario.task, name),
      materials: `同一触发条件：${text(scenario.trigger, "待写清")}；同一期望结果：${text(scenario.outcome, "待写清")}`,
      success: text(scenario.outcome, "产物可验收，并符合事先写好的结果"),
    });
  }
  return proposed.slice(0, 8);
}

export function summarizeBakeoff(tasks = [], products = []) {
  const rows = products.map((product) => {
    const runs = tasks.flatMap((task) => task.runs.filter((run) => namesMatch(run.product, product)));
    const ran = runs.filter((run) => run.status !== "not_run");
    const passed = ran.filter((run) => run.status === "passed").length;
    const partial = ran.filter((run) => run.status === "partial").length;
    const failed = ran.filter((run) => run.status === "failed").length;
    return {
      product,
      ran: ran.length,
      passed,
      partial,
      failed,
      notRun: runs.length - ran.length,
      completionRate: ran.length ? Math.round((passed / ran.length) * 100) : null,
    };
  });
  const ranTasks = tasks.filter((task) => task.runs.some((run) => run.status !== "not_run")).length;
  return {
    products: rows,
    taskCount: tasks.length,
    ranTaskCount: ranTasks,
    unrunTaskCount: tasks.length - ranTasks,
    measuredRunCount: tasks.reduce((sum, task) => sum + task.runs.filter((run) => run.status !== "not_run").length, 0),
  };
}

export function bakeoffSummaryText(scorecard) {
  if (!scorecard?.taskCount) return "尚未建立黄金任务评测集。";
  if (!scorecard.ranTaskCount) {
    return `已列出 ${scorecard.taskCount} 个黄金任务，但都还没实测。格子保持「未跑」，不能用官网能力填满分。`;
  }
  const leaders = (scorecard.products || [])
    .filter((item) => item.ran)
    .map((item) => `${item.product} 交差 ${item.passed}/${item.ran}`);
  return `已实测 ${scorecard.ranTaskCount}/${scorecard.taskCount} 个任务。${leaders.join("；") || "尚无交差记录"}。未跑的格子不得写成领先。`;
}

export function compileBakeoff(analysis = {}) {
  const products = (analysis.competitors || []).map((item) => text(item?.name)).filter(Boolean);
  const researchMode = analysis.research?.mode || "manual";
  const incoming = analysis.bakeoff && typeof analysis.bakeoff === "object" ? analysis.bakeoff : {};
  const incomingTasks = Array.isArray(incoming.tasks) ? incoming.tasks : [];
  const proposed = proposeGoldenTasks(analysis);
  const incomingByKey = new Map();
  for (const task of incomingTasks) {
    const key = taskKey(task);
    if (key && !incomingByKey.has(key)) incomingByKey.set(key, task);
  }
  const merged = [];
  const seen = new Set();

  for (const task of proposed) {
    const extra = incomingByKey.get(taskKey(task)) || {};
    const definition = mergeTaskDefinition(task, extra);
    const key = taskKey(definition);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push({
      ...definition,
      runs: products.map((product) => normalizeRun(findRun(extra.runs, product), product, researchMode)),
    });
  }

  for (const task of incomingTasks) {
    const definition = mergeTaskDefinition({
      id: text(task.id, `T${String(merged.length + 1).padStart(2, "0")}`),
      name: text(task.name, `黄金任务 ${merged.length + 1}`),
      job: text(task.job, text(task.name, "待写清工作")),
      materials: text(task.materials, "同一份材料、同一条任务说明"),
      success: text(task.success, "事先写清的交差标准"),
    }, task);
    const key = taskKey(definition);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push({
      ...definition,
      runs: products.map((product) => normalizeRun(findRun(task.runs, product), product, researchMode)),
    });
  }

  const tasks = merged.slice(0, 8);
  const scorecard = summarizeBakeoff(tasks, products);
  return {
    method: "同一份工作实测：固定任务、同一材料、同一成功标准。未跑写未跑，禁止用功能清单或官网宣传填满分。",
    protocol: Array.isArray(incoming.protocol) && incoming.protocol.length
      ? incoming.protocol.map((item) => String(item)).slice(0, 8)
      : [
        "事先写清任务、材料和交差标准，三个产品用同一份",
        "只记录实测：是否交差、人工介入几次、第一次可用结果要多久、产物能不能直接用、失败后能不能继续、费用",
        "没有跑过的格子保持「未跑」，不要根据界面或文档推断通过",
      ],
    metrics: BAKEOFF_METRICS,
    tasks,
    scorecard,
    summary: bakeoffSummaryText(scorecard),
  };
}

export function statusLabel(status) {
  return { not_run: "未跑", passed: "交差", partial: "部分完成", failed: "未交差" }[status] || "未跑";
}

export function formatRunCell(run) {
  if (!run || run.status === "not_run") return { title: "未跑", detail: "尚未实测" };
  const bits = [
    run.interventions != null ? `介入 ${run.interventions} 次` : "",
    run.timeToValueMinutes != null ? `${run.timeToValueMinutes} 分钟` : "",
    run.deliverableUsable === true ? "产物可直接用" : run.deliverableUsable === false ? "产物还不能直接用" : "",
    run.recoveredFromFailure === "yes" ? "失败后能继续" : run.recoveredFromFailure === "no" ? "失败后不能继续" : "",
    run.cost && run.cost !== "未记录" ? run.cost : "",
  ].filter(Boolean);
  return {
    title: statusLabel(run.status),
    detail: bits.join(" · ") || run.notes || "有实测记录",
  };
}

export function formatRunCellText(run) {
  const cell = formatRunCell(run);
  if (!run || run.status === "not_run") return "未跑";
  return cell.detail ? `${cell.title}｜${cell.detail}` : cell.title;
}
