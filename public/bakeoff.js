const STATUSES = ["not_run", "passed", "partial", "failed"];
const SOURCES = ["unrun", "measured", "inferred"];
const RECOVERIES = ["not_run", "yes", "no", "not_applicable"];
const PATH_CHANNELS = ["none", "official_web", "official_tutorial", "video_walkthrough", "secondary_walkthrough"];
const PATH_STAGES = ["进入", "发起", "配置", "执行", "交付", "失败", "治理"];
const UI_PATH_TYPES = ["actual_app_ui", "official_tutorial", "video_walkthrough", "secondary_walkthrough", "user_supplied"];
const INFERRED_CLAIM_RE = /具备此能力|支持该任务|可以完成|能够完成|官网显示|功能清单|理应|应该能|宣传称/u;
const PLACEHOLDER_RE = /^(待验证|待补充|待定义|未记录|未跑|)$/u;
const TASK_PATH_NEEDLES = {
  T01: /文件|文档|交付物|导出|本地|幻灯|ppt|word|整理|可编辑/iu,
  T02: /研究|来源|引用|网页|对比|检索|报告/iu,
  T03: /技能|专家|套件|岗位|角色/iu,
  T04: /连接器|写回|集成|外部系统|crm|同步/iu,
  T05: /失败|重试|恢复|中断|续跑|停止/iu,
};
const CHANNEL_LABEL = {
  none: "未见公开操作路径",
  official_web: "官方网页版",
  official_tutorial: "官方教程",
  video_walkthrough: "实操视频",
  secondary_walkthrough: "实操图文",
};

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

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export function emptyPublicPath() {
  return { channel: "none", url: "", stagesSeen: [], notes: "未见公开操作路径" };
}

export function normalizePublicPath(raw) {
  const incoming = raw && typeof raw === "object" ? raw : {};
  const url = safeHttpUrl(incoming.url);
  let channel = PATH_CHANNELS.includes(incoming.channel) ? incoming.channel : "none";
  const stagesSeen = [...new Set((Array.isArray(incoming.stagesSeen) ? incoming.stagesSeen : [])
    .map((item) => String(item || "").trim())
    .filter((item) => PATH_STAGES.includes(item)))].slice(0, 5);
  const notes = text(incoming.notes);
  if (channel !== "none" && !url) channel = "none";
  if (channel === "none") return emptyPublicPath();
  return {
    channel,
    url,
    stagesSeen,
    notes: notes || "有公开操作路径，不是实测交差",
  };
}

function channelFromSourceType(sourceType) {
  return {
    actual_app_ui: "official_web",
    official_tutorial: "official_tutorial",
    video_walkthrough: "video_walkthrough",
    secondary_walkthrough: "secondary_walkthrough",
    user_supplied: "official_web",
  }[sourceType] || "none";
}

function auditBlob(screen) {
  return [screen?.screen, screen?.purpose, screen?.annotation, screen?.usageStage, screen?.primaryAction, screen?.feedback]
    .map((item) => String(item || "")).join(" ");
}

function screensForProduct(analysis, product) {
  const audits = analysis?.productExperience?.competitorAudits || [];
  const audit = audits.find((item) => namesMatch(item?.competitorName, product));
  return (audit?.interfaceAudit || []).filter((screen) => UI_PATH_TYPES.includes(screen?.sourceType) && safeHttpUrl(screen?.sourceUrl));
}

function publicPathFromUi(analysis, product, task) {
  const screens = screensForProduct(analysis, product);
  if (!screens.length) return emptyPublicPath();
  const needle = TASK_PATH_NEEDLES[task.id] || new RegExp(compactName(task.name).slice(0, 6) || "_{8}");
  const picked = screens.filter((screen) => needle.test(auditBlob(screen)));
  if (!picked.length) return emptyPublicPath();
  const best = picked.find((item) => /交付|执行/u.test(item.usageStage || "")) || picked[0];
  return normalizePublicPath({
    channel: channelFromSourceType(best.sourceType),
    url: best.sourceUrl,
    stagesSeen: picked.map((item) => item.usageStage).filter((item) => PATH_STAGES.includes(item)),
    notes: text(best.annotation || best.purpose, "界面证据里能看到这条任务的操作路径"),
  });
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
    publicPath: emptyPublicPath(),
  };
}

export function normalizeRun(run, product, researchMode = "manual") {
  const base = emptyRun(product);
  const incoming = run && typeof run === "object" ? run : {};
  let status = STATUSES.includes(incoming.status) ? incoming.status : "not_run";
  let source = SOURCES.includes(incoming.source) ? incoming.source : (status === "not_run" ? "unrun" : "inferred");
  const notes = text(incoming.notes, status === "not_run" ? "未跑" : "");
  const evidenceIds = Array.isArray(incoming.evidenceIds) ? incoming.evidenceIds.map((item) => String(item || "").trim()).filter(Boolean) : [];
  const publicPath = normalizePublicPath(incoming.publicPath);
  const looksInferred = source === "inferred"
    || INFERRED_CLAIM_RE.test(notes)
    || (status !== "not_run" && PLACEHOLDER_RE.test(notes) && !evidenceIds.length);
  if (status !== "not_run" && researchMode !== "demo") {
    if (source !== "measured" || (looksInferred && !evidenceIds.length)) {
      return { ...emptyRun(product), publicPath, evidenceIds };
    }
  }
  if (status === "not_run") {
    return {
      ...base,
      notes: notes && !PLACEHOLDER_RE.test(notes) ? notes : "未跑",
      evidenceIds,
      publicPath,
    };
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
    publicPath,
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
  const pathRuns = tasks.reduce((sum, task) => sum + task.runs.filter((run) => run.publicPath?.channel && run.publicPath.channel !== "none").length, 0);
  const pathTasks = tasks.filter((task) => task.runs.some((run) => run.publicPath?.channel && run.publicPath.channel !== "none")).length;
  return {
    products: rows,
    taskCount: tasks.length,
    ranTaskCount: ranTasks,
    unrunTaskCount: tasks.length - ranTasks,
    measuredRunCount: tasks.reduce((sum, task) => sum + task.runs.filter((run) => run.status !== "not_run").length, 0),
    pathRunCount: pathRuns,
    pathTaskCount: pathTasks,
  };
}

export function bakeoffSummaryText(scorecard) {
  if (!scorecard?.taskCount) return "尚未建立黄金任务评测集。";
  const pathBit = scorecard.pathRunCount
    ? `已从公开网页版/教程/视频核验 ${scorecard.pathRunCount} 条操作路径，这些路径不是交差。`
    : "还没有核验到可打开的公开操作路径。";
  if (!scorecard.ranTaskCount) {
    return `已列出 ${scorecard.taskCount} 个黄金任务，都还没实测。${pathBit}格子保持「未跑」，不能用官网能力填满分。`;
  }
  const leaders = (scorecard.products || [])
    .filter((item) => item.ran)
    .map((item) => `${item.product} 交差 ${item.passed}/${item.ran}`);
  return `已实测 ${scorecard.ranTaskCount}/${scorecard.taskCount} 个任务。${leaders.join("；") || "尚无交差记录"}。${pathBit}未跑的格子不得写成领先。`;
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
  for (const task of tasks) {
    task.runs = task.runs.map((run) => {
      if (run.publicPath?.channel && run.publicPath.channel !== "none") return run;
      const attached = publicPathFromUi(analysis, run.product, task);
      return attached.channel === "none" ? run : { ...run, publicPath: attached };
    });
  }
  const scorecard = summarizeBakeoff(tasks, products);
  return {
    method: "同一份工作对照：不装竞品软件。先核验公开网页版/教程/视频里的操作路径；没有本机实测的格子写未跑，公开路径不能写成交差。",
    protocol: Array.isArray(incoming.protocol) && incoming.protocol.length
      ? incoming.protocol.map((item) => String(item)).slice(0, 8)
      : [
        "事先写清任务、材料和交差标准，三个产品用同一份",
        "联网只打开网页版、官方教程和实操视频，不下载安装包",
        "看到进入/执行/交付路径就写入 publicPath；status 仍是 not_run",
        "只有用户材料里已有实测记录时，才填写交差、介入次数和费用",
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

function pathDetail(run) {
  const path = run?.publicPath;
  if (!path || path.channel === "none") return "未见公开操作路径";
  const stages = (path.stagesSeen || []).join("/");
  return `公开路径：${CHANNEL_LABEL[path.channel] || path.channel}${stages ? ` · ${stages}` : ""}`;
}

export function formatRunCell(run) {
  if (!run || run.status === "not_run") return { title: "未跑", detail: pathDetail(run) };
  const bits = [
    run.interventions != null ? `介入 ${run.interventions} 次` : "",
    run.timeToValueMinutes != null ? `${run.timeToValueMinutes} 分钟` : "",
    run.deliverableUsable === true ? "产物可直接用" : run.deliverableUsable === false ? "产物还不能直接用" : "",
    run.recoveredFromFailure === "yes" ? "失败后能继续" : run.recoveredFromFailure === "no" ? "失败后不能继续" : "",
    run.cost && run.cost !== "未记录" ? run.cost : "",
    run.publicPath?.channel && run.publicPath.channel !== "none" ? pathDetail(run) : "",
  ].filter(Boolean);
  return {
    title: statusLabel(run.status),
    detail: bits.join(" · ") || run.notes || "有实测记录",
  };
}

export function formatRunCellText(run) {
  const cell = formatRunCell(run);
  if (!run || run.status === "not_run") {
    return cell.detail && cell.detail !== "未见公开操作路径" ? `未跑｜${cell.detail}` : "未跑";
  }
  return cell.detail ? `${cell.title}｜${cell.detail}` : cell.title;
}
