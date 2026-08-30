const PLACEHOLDER_RE = /^(待验证|待补充|待定义|待标注|待指定|待从界面验证)$/u;
const STAGE_ORDER = ["进入", "发起", "配置", "执行", "交付", "治理"];

const LAYER_PLAYBOOKS = [
  {
    keys: ["workbuddy"],
    designFocus: "以独立任务为对象：先选岗位域，再选 Ask/Craft/Plan 放权，发起前确认工作空间",
    strengths: ["任务而不是会话作为主对象", "Ask/Craft/Plan 把动手权限做成显式选择", "助理把远程遥控从日常任务里拆出去", "交付物可预览、可回看"],
    weaknesses: ["岗位域、放权模式、技能和权限叠在同一输入条，新用户选择顺序不清晰"],
    structure: [
      { text: "一级 IA：新建任务 / 助理 / 项目 / 专家·技能·连接器 / 自动化 / 资料库·灵感，主对象是任务不是会话" },
      { text: "岗位域：日常办公 / 代码开发 / 设计创意；放权：Ask 仅问答、Craft 默认执行、Plan 先计划后动手" },
      { text: "电脑端是执行面；助理是人离开电脑时的遥控监控室，固定写入 Claw 目录，不能并行、不能清空上下文" },
      { text: "任务流：进入工作台 → 选岗位域 → 选放权模式 → 选定工作空间 → 发起 → 执行 → 产物预览" },
      { text: "工作空间与权限是任务的执行边界；系统设置另开 master-detail（模型/记忆/助理设置）", need: ["配置", "治理"] },
    ],
    framework: [
      { text: "左导航 + 中央大输入工作台；输入条「+」展开添加文件 / 模式 / 专家 / 技能 / 连接器" },
      { text: "计划、仅问答是输入条模式菜单里的开关，不是侧栏一级入口" },
      { text: "工作空间和默认权限挂在输入框下方；系统设置左侧分组、右侧开关" },
      { text: "助理旁的文件夹直接打开本机 Claw 目录，远程指令仍在本地落地" },
    ],
    surface: [
      { text: "浅色桌面工作台：侧栏任务对象 + 中央大输入框 + 岗位域胶囊，而不是营销 Banner" },
      { text: "零状态用最佳实践卡片；权限用对勾；设置用 master-detail；助理用本机文件夹对照" },
    ],
    settings: [
      { name: "工作模式", purpose: "在日常办公与代码开发之间切换能力边界", defaultValue: "日常办公", userImpact: "决定后续技能、连接器和权限", businessIntent: "同一工作台覆盖两类岗位", need: ["进入"] },
      { name: "工作空间", purpose: "限定 Agent 可读写的文件范围", defaultValue: "需选择", userImpact: "生成文件写入选定目录", businessIntent: "把执行边界做成可审计对象", need: ["配置"] },
      { name: "权限模式", purpose: "在默认权限与完全访问之间选择", defaultValue: "默认权限", userImpact: "高权限会修改文件并外呼", businessIntent: "把治理做成发起前的确认", need: ["治理"] },
    ],
  },
  {
    keys: ["traework", "trae"],
    designFocus: "先选 Work/Code/Design 模式，再在项目内执行并打开产物面板",
    strengths: ["模式分流清晰", "Todos 与产物在同一工作台"],
    weaknesses: ["用户必须预先判断任务属于哪种模式"],
    structure: [
      { text: "一级分流是 Work / Code / Design，任务挂在项目上而不是漂浮会话" },
      { text: "对象流：选择模式 → 进入项目 → 提交带环境的任务 → 工具面板跟踪待办与产物" },
    ],
    framework: [
      { text: "左上模式切换 + 任务列表 + 主工作区；执行时右侧 Todos / 产物 / 参考页签" },
      { text: "发起时就要带附件、技能和运行环境，而不是先聊天再补上下文" },
    ],
    surface: [
      { text: "高密度 IDE 式工作台，模式入口与工具面板并重，产物在页签中预览" },
    ],
  },
  {
    keys: ["qwenwork", "千问办公"],
    designFocus: "桌面三栏工作台：侧栏模块、中央任务、右侧监控与产物",
    strengths: ["任务监控对用户可见", "定时任务可离开当前会话"],
    weaknesses: ["扩展、频道和任务入口并列，需要用户自己分类"],
    structure: [
      { text: "一级 IA：新任务 / 扩展（专家套件·技能·连接器）/ 定时任务 / IM 频道 / 任务历史" },
      { text: "任务流：主窗口发起 → 右侧监控计划与工具 → 产物卡片收取并可续改" },
    ],
    framework: [
      { text: "左导航 + 中央输入 + 右侧任务监控；执行中展示计划、技能/MCP 与文件操作" },
      { text: "工作目录挂在输入区下方；定时任务让流程离开当前会话继续跑" },
    ],
    surface: [
      { text: "浅色桌面客户端，侧栏模块 + 问候语 + 大输入框，完成态用产物卡片而不是长文本" },
    ],
  },
  {
    keys: ["doubaowork", "豆包工作"],
    designFocus: "飞书原生打通的办公 Agent：飞书账号登录即继承企业文档、权限和额度，再在电脑版执行",
    strengths: ["飞书一键登录，组织身份出现在左下角", "技能/连接器/伙伴与任务入口分开", "手机遥控电脑是一级入口"],
    weaknesses: ["个人豆包账号与飞书企业身份并列，技能、连接器、伙伴的边界需要额外解释"],
    structure: [
      { text: "豆包工作是飞书团队×豆包团队合并后的第一款 Agent，不是豆包 App 换皮，也不是飞书 CLI 的外壳" },
      { text: "一级 IA：新工作任务 / 定时任务 / 技能·连接器·伙伴 / 伙伴对话 / 云盘 / 手机遥控电脑" },
      { text: "覆盖端：电脑版执行、云电脑长任务、手机遥控、飞书团队版；登录主路径是飞书账号" },
      { text: "能力资产与任务入口分开：先装连接器/伙伴，再在工作任务中调用；产物可回写飞书文档和多维表" },
    ],
    framework: [
      { text: "左侧功能菜单 + 中央问候与场景胶囊 + 底部输入条（工作任务/项目/企业知识/连接器）" },
      { text: "飞书一键登录是主按钮；扫码同时认豆包 App 和飞书 App" },
      { text: "技能页是搜索+分类+卡片宫格；伙伴页是岗位人设卡片，和连接器不是同一层对象" },
    ],
    surface: [
      { text: "电脑版浅色工作台：细侧栏图标+文字，左下角企业实名，输入条对象化，而不是营销落地页" },
      { text: "登录窗把飞书按钮做成主 CTA；技能市场用连接器标签和 + 加入" },
    ],
  },
  {
    keys: ["microsoft365copilot", "microsoftcopilot"],
    designFocus: "套件内 Agent 零状态：先声明身份，再用提示卡片进入对话",
    strengths: ["提示卡片降低空白页", "答案带来源引用"],
    weaknesses: ["主对象仍是消息流，缺少独立任务监控页"],
    structure: [
      { text: "能力挂在 Agent 身份上：先声明范围，再用提示卡片映射到企业工作项" },
      { text: "主对象仍是对话消息，而不是可恢复的任务实体" },
    ],
    framework: [
      { text: "窄侧栏 + 中央提示卡片网格 + 底部输入条" },
      { text: "执行以流式文本推进；交付用引用标记点回来源，而不是独立预览窗" },
    ],
    surface: [
      { text: "低密度零状态：Agent 标识 + 场景卡片 + 底部输入；企业感来自引用标记和 AI 标识" },
    ],
  },
];

function compactName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/gu, "");
}

export function playbookFor(name) {
  const compact = compactName(name);
  if (!compact) return null;
  return LAYER_PLAYBOOKS.find((item) => item.keys.some((key) => {
    if (key.length >= 6) return compact.includes(key) || (compact.length >= 6 && key.includes(compact));
    return compact === key || compact.startsWith(key) || compact.endsWith(key);
  })) || null;
}

function isPlaceholder(value) {
  if (Array.isArray(value)) return !value.length || value.every(isPlaceholder);
  const text = String(value || "").trim();
  return !text || PLACEHOLDER_RE.test(text);
}

function unique(items, limit = 6) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const text = String(item || "").replace(/\s+/g, " ").trim();
    if (!text || isPlaceholder(text) || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

export function evidencedScreens(audit) {
  return (audit?.interfaceAudit || []).filter((item) => item?.imageUrl && item.sourceType !== "unverified");
}

function stagesOf(screen) {
  return String(screen?.usageStage || "").split(/[/、,，]/u).map((part) => part.trim()).filter(Boolean);
}

function collectStages(screens) {
  const set = new Set();
  for (const screen of screens) stagesOf(screen).forEach((stage) => set.add(stage));
  return set;
}

function stageMatches(need, stages) {
  if (!need?.length) return true;
  return need.some((item) => stages.has(item) || [...stages].some((stage) => stage.includes(item) || item.includes(stage)));
}

function pickLines(lines, stages) {
  return unique((lines || []).filter((line) => {
    if (typeof line === "string") return true;
    return stageMatches(line.need, stages);
  }).map((line) => (typeof line === "string" ? line : line.text)));
}

function screenBlob(screen) {
  const callouts = (screen.callouts || []).map((item) => `${item.label || ""} ${item.insight || ""}`).join(" ");
  return `${screen.screen || ""} ${screen.usageStage || ""} ${screen.purpose || ""} ${screen.entry || ""} ${screen.primaryAction || ""} ${screen.feedback || ""} ${screen.annotation || ""} ${callouts}`;
}

function blobOf(screens) {
  return screens.map(screenBlob).join(" ");
}

function calloutInsights(screens, matcher) {
  return unique(screens.flatMap((screen) => (screen.callouts || [])
    .filter((item) => matcher.test(`${item.label || ""}${item.insight || ""}`))
    .map((item) => item.insight || item.label)));
}

export function deriveStructure(screens) {
  const flow = unique(screens.map((screen) => `${stagesOf(screen)[0] || screen.usageStage}·${screen.screen}`), 8);
  const ia = calloutInsights(screens, /侧栏|导航|入口|任务|项目|技能|空间|模式|频道|助理|专家|自动化|连接器|工作区/);
  const objectHint = screens.flatMap((screen) => (screen.callouts || []).map((item) => item.insight))
    .find((text) => /任务|会话|聊天|项目|工作台|Agent/.test(String(text || "")));
  return unique([
    flow.length ? `界面对象流：${flow.join(" → ")}` : "",
    objectHint,
    ...ia,
  ]);
}

export function deriveFramework(screens) {
  const layoutHints = calloutInsights(screens, /侧栏|输入|面板|预览|监控|模式|权限|工作空间|页签|卡片/);
  const loops = screens.map((screen) => {
    const entry = isPlaceholder(screen.entry) ? "" : screen.entry;
    const action = isPlaceholder(screen.primaryAction) ? "" : screen.primaryAction;
    const feedback = isPlaceholder(screen.feedback) ? "" : screen.feedback;
    if (!entry && !action) return "";
    return `${screen.screen}：${[entry && `入口「${entry}」`, action && `主操作「${action}」`, feedback && `反馈「${feedback}」`].filter(Boolean).join(" → ")}`;
  });
  const inner = screens.some((screen) => /配置|执行|交付|治理/.test(screen.usageStage || ""));
  return unique([
    inner ? "主界面负责任务发起，功能内页承担配置、执行监控与结果验收" : "当前核验到的是主工作台；配置/执行/交付内页仍待补截图",
    ...layoutHints,
    ...loops,
  ]);
}

export function deriveSurface(screens) {
  const labels = unique(screens.flatMap((screen) => (screen.callouts || []).map((item) => item.label)), 8);
  const home = screens.some((screen) => /进入/.test(screen.usageStage || ""));
  const inner = screens.some((screen) => /配置|执行|交付|治理/.test(screen.usageStage || ""));
  return unique([
    home && inner ? "主工作台与功能内页分层呈现，而不是只有官网首屏" : (home ? "可见主工作台/零状态，功能内页仍待补" : "从已核验截图读取控件组织"),
    labels.length ? `可见控件：${labels.join("、")}` : "",
    screens.some((screen) => /卡片|预览|案例/.test(screenBlob(screen))) ? "用场景卡片或产物预览降低空白页，而不是纯营销图" : "",
  ]);
}

function pickLayer(playbookLines, derived, stages) {
  const fromPlaybook = pickLines(playbookLines, stages);
  return fromPlaybook.length >= 2 ? fromPlaybook : unique([...fromPlaybook, ...derived]);
}

function screenForStage(screens, stage) {
  return screens.find((screen) => stagesOf(screen).some((item) => item.includes(stage) || stage.includes(item))) || screens[0];
}

function compileSwimlanes(screens) {
  const stages = collectStages(screens);
  const present = STAGE_ORDER.filter((stage) => [...stages].some((item) => item.includes(stage) || stage.includes(item)));
  return present.map((stage) => {
    const screen = screenForStage(screens, stage);
    const fallback = {
      进入: {
        user: `打开「${screen.screen}」并阅读信息架构`,
        frontend: isPlaceholder(screen.purpose) ? "展示侧栏、模式与主工作区" : screen.purpose,
        agent: "待命",
        operations: "可配置推荐场景或默认模板",
        data: "读取最近任务、可用技能与工作空间",
      },
      发起: {
        user: isPlaceholder(screen.primaryAction) ? "提交任务" : screen.primaryAction,
        frontend: isPlaceholder(screen.entry) ? "回显输入、模式与附件" : `从「${screen.entry}」收集输入`,
        agent: "生成执行计划并创建任务",
        operations: "可选模板或额度校验",
        data: "写入 task、prompt、mode",
      },
      配置: {
        user: isPlaceholder(screen.primaryAction) ? "选择工作空间或技能" : screen.primaryAction,
        frontend: "弹出选择器并回显当前范围",
        agent: "在授权范围内准备工具",
        operations: "目录/连接器策略",
        data: "写入 workspace 或 skill 绑定",
      },
      执行: {
        user: "观察进度并决定等待、补充或停止",
        frontend: isPlaceholder(screen.feedback) ? "展示运行/完成/失败状态" : screen.feedback,
        agent: "调用技能、读写文件并更新步骤",
        operations: "失败告警与重试策略",
        data: "写入 task_run、tool_call",
      },
      交付: {
        user: "预览产物并决定保存、修订或复跑",
        frontend: isPlaceholder(screen.feedback) ? "展示产物卡片或预览窗" : screen.feedback,
        agent: "生成可下载对象并保留上下文",
        operations: "质量抽检",
        data: "写入 artifact 与引用",
      },
      治理: {
        user: isPlaceholder(screen.primaryAction) ? "确认权限范围" : screen.primaryAction,
        frontend: "在确认前展示风险说明",
        agent: "按授权范围执行",
        operations: "审计高权限操作",
        data: "写入 permission_grant 与 audit_log",
      },
    }[stage];
    return { stage, ...fallback };
  });
}

function compileTracking(screens) {
  const stages = collectStages(screens);
  const events = [
    { stage: "进入", event: "workbench_opened", metric: "工作台到达率", decision: "判断冷启动是否发生", properties: ["screen", "source"] },
    { stage: "发起", event: "task_created", metric: "任务发起率", decision: "判断激活是否发生", properties: ["mode", "has_attachment"] },
    { stage: "配置", event: "workspace_selected", metric: "执行边界完整率", decision: "判断范围设置是否成为摩擦", properties: ["workspace_type"] },
    { stage: "执行", event: "task_run_updated", metric: "长任务可感知率", decision: "决定是否补进度与停止", properties: ["status", "elapsed_ms"] },
    { stage: "交付", event: "artifact_previewed", metric: "产物验收率", decision: "判断交付是否闭环", properties: ["artifact_type"] },
    { stage: "治理", event: "permission_confirmed", metric: "高权限确认率", decision: "平衡效率与风险", properties: ["permission_level"] },
  ];
  return events.filter((item) => stageMatches([item.stage], stages)).map((item) => {
    const screen = screenForStage(screens, item.stage);
    return {
      event: item.event,
      trigger: isPlaceholder(screen.primaryAction) ? `${item.stage}·${screen.screen}` : screen.primaryAction,
      properties: item.properties,
      metric: item.metric,
      decision: item.decision,
    };
  });
}

function compileDataModel(screens) {
  const blob = blobOf(screens);
  const entities = [];
  if (/任务/.test(blob)) entities.push({ name: "task", purpose: "独立任务对象，而不是一次聊天", keyFields: ["task_id", "status", "mode"], relations: ["belongs_to workspace"], retention: "任务与产物可回看" });
  if (/工作空间|工作目录|项目/.test(blob)) entities.push({ name: "workspace", purpose: "文件与执行边界", keyFields: ["workspace_id", "path"], relations: ["has_many tasks"], retention: "授权范围可审计" });
  if (/技能|连接器|MCP|扩展/.test(blob)) entities.push({ name: "skill", purpose: "可复用执行能力", keyFields: ["skill_id", "source"], relations: ["used_by task_run"], retention: "安装与调用可追溯" });
  if (/权限|完全访问/.test(blob)) entities.push({ name: "permission_grant", purpose: "发起前确认的执行权限", keyFields: ["grant_id", "level"], relations: ["belongs_to task"], retention: "高权限必须留审计" });
  if (/产物|预览|结果|引用/.test(blob)) entities.push({ name: "artifact", purpose: "可预览、可下载的交付物", keyFields: ["artifact_id", "type"], relations: ["belongs_to task"], retention: "随任务回看" });
  return {
    principles: unique([
      /任务/.test(blob) ? "任务是主键，会话只是任务的一种视图" : "",
      /工作空间|工作目录|项目/.test(blob) ? "文件范围必须能从界面读出并写入 workspace" : "",
      /权限|引用/.test(blob) ? "权限授予和来源引用都要可审计" : "只为界面上出现过的对象建模",
    ]),
    entities: entities.slice(0, 6),
  };
}

function compileBackend(name, screens) {
  const blob = blobOf(screens);
  const apis = [];
  const jobs = [];
  if (/任务/.test(blob)) {
    apis.push({ method: "POST", path: "/api/tasks", purpose: `创建${name}任务`, payload: "goal, mode, workspace_id, permission_level" });
    jobs.push({ name: "run_task", trigger: "task.created", writes: "task_run, tool_call, artifact" });
  }
  if (/工作空间|工作目录/.test(blob)) apis.push({ method: "POST", path: "/api/workspaces", purpose: "绑定本地或云端工作空间", payload: "path, name" });
  if (/权限/.test(blob)) apis.push({ method: "POST", path: "/api/tasks/:id/permissions", purpose: "确认执行权限", payload: "level, acknowledged_risk" });
  if (/产物|预览|结果/.test(blob)) apis.push({ method: "GET", path: "/api/tasks/:id/artifacts", purpose: "读取可预览产物", payload: "task_id" });
  return {
    summary: `从「${screens.map((item) => item.screen).join(" / ")}」反推：界面出现过的对象才进入最小交付，不补未核验能力。`,
    userStories: unique(screens.map((screen) => `作为用户，我可以在「${screen.screen}」${isPlaceholder(screen.primaryAction) ? "完成该屏主任务" : screen.primaryAction}`), 6),
    apis: apis.slice(0, 6),
    jobs: jobs.slice(0, 4),
    permissions: unique([
      /权限|完全访问/.test(blob) ? "高权限必须显式确认并记入审计" : "",
      /工作空间|工作目录/.test(blob) ? "Agent 只能读写已选工作空间" : "",
    ]),
    acceptance: unique(screens.map((screen) => isPlaceholder(screen.feedback) ? `${screen.screen}的状态可被看见` : `${screen.screen}反馈「${screen.feedback}」可复现`), 6),
  };
}

function compileSettings(screens, playbook, stages) {
  const fromPlaybook = (playbook?.settings || []).filter((item) => stageMatches(item.need, stages)).map((item) => ({
    name: item.name,
    purpose: item.purpose,
    defaultValue: item.defaultValue,
    userImpact: item.userImpact,
    businessIntent: item.businessIntent,
  }));
  if (fromPlaybook.length) return fromPlaybook.slice(0, 8);
  return unique(screens.flatMap((screen) => (screen.callouts || [])
    .filter((item) => /模式|权限|空间|技能|模型|目录/.test(`${item.label}${item.insight}`))
    .map((item) => item.label)), 6).map((name) => ({
    name,
    purpose: `界面上的「${name}」选择`,
    defaultValue: "待从控件读取",
    userImpact: "改变本次任务的能力或范围",
    businessIntent: "把关键决策前置到发起动作",
  }));
}

export function compileFromDocsMap(docsMap) {
  if (!docsMap) return [];
  const platforms = (docsMap.platforms || []).map((item) => item.name).filter(Boolean);
  const modules = (docsMap.modules || []).map((item) => item.name).filter(Boolean);
  const notes = docsMap.notes || [];
  return unique([
    platforms.length ? `覆盖端：${platforms.join(" / ")}` : "",
    modules.length ? `官方功能树：${modules.slice(0, 14).join(" / ")}` : "",
    ...notes.slice(0, 2),
  ], 4);
}

function compileProductFromScreens(name, screens, playbook, docsMap) {
  const ready = (screens || []).filter((item) => item?.imageUrl && item.sourceType !== "unverified");
  const fromDocs = compileFromDocsMap(docsMap);
  if (!ready.length) {
    return {
      designFocus: playbook?.designFocus || "待从界面验证",
      designLogic: fromDocs,
      interactionLogic: [],
      strengths: [],
      weaknesses: [],
      settings: [],
      fiveLayers: { structure: fromDocs, framework: [], surface: [] },
      swimlanes: [],
      trackingPlan: [],
      dataModel: { principles: [], entities: [] },
      backendDelivery: { summary: "", userStories: [], apis: [], jobs: [], permissions: [], acceptance: [] },
    };
  }
  const stages = collectStages(ready);
  const structure = unique([...fromDocs, ...pickLayer(playbook?.structure, deriveStructure(ready), stages)], 8);
  const framework = pickLayer(playbook?.framework, deriveFramework(ready), stages);
  const surface = pickLayer(playbook?.surface, deriveSurface(ready), stages);
  return {
    designFocus: playbook?.designFocus || structure[0] || `${name}的界面侧重点待从更多内页验证`,
    designLogic: structure,
    interactionLogic: framework,
    strengths: unique(playbook?.strengths || calloutInsights(ready, /任务|可见|产物|引用|权限/), 4),
    weaknesses: unique(playbook?.weaknesses || ready.map((screen) => screen.friction), 4),
    settings: compileSettings(ready, playbook, stages),
    fiveLayers: { structure, framework, surface },
    swimlanes: compileSwimlanes(ready),
    trackingPlan: compileTracking(ready),
    dataModel: compileDataModel(ready),
    backendDelivery: compileBackend(name, ready),
  };
}

function findAudit(audits, name) {
  return (audits || []).find((item) => item.competitorName === name)
    || (audits || []).find((item) => compactName(item.competitorName) && compactName(item.competitorName) === compactName(name));
}

export function compileUiAuditFromScreens(analysis) {
  if (!analysis) return analysis;
  const px = analysis.productExperience || (analysis.productExperience = {});
  const audits = Array.isArray(px.competitorAudits) ? px.competitorAudits : (px.competitorAudits = []);
  const competitors = Array.isArray(analysis.competitors) ? analysis.competitors : [];
  for (const competitor of competitors) {
    const audit = findAudit(audits, competitor.name);
    if (!audit) continue;
    const playbook = playbookFor(competitor.name);
    const compiled = compileProductFromScreens(competitor.name, audit.interfaceAudit, playbook, audit.docsMap);
    const ready = evidencedScreens(audit);
    if (!ready.length && !compiled.fiveLayers.structure.length) continue;
    competitor.fiveLayers = competitor.fiveLayers || {};
    competitor.fiveLayers.structure = compiled.fiveLayers.structure;
    competitor.fiveLayers.framework = compiled.fiveLayers.framework;
    competitor.fiveLayers.surface = compiled.fiveLayers.surface;
    if (isPlaceholder(competitor.fiveLayers.strategy) && compiled.designFocus) competitor.fiveLayers.strategy = compiled.designFocus;
    if (isPlaceholder(competitor.fiveLayers.scope)) {
      competitor.fiveLayers.scope = unique([
        ...(audit.docsMap?.modules || []).map((item) => item.name),
        ...(audit.interfaceAudit || []).flatMap((item) => (item.callouts || []).map((callout) => callout.label)),
      ], 8);
    }
    Object.assign(audit, {
      designFocus: compiled.designFocus,
      designLogic: compiled.designLogic,
      interactionLogic: compiled.interactionLogic,
      strengths: compiled.strengths.length ? compiled.strengths : audit.strengths,
      weaknesses: compiled.weaknesses.length ? compiled.weaknesses : audit.weaknesses,
      settings: compiled.settings.length ? compiled.settings : audit.settings,
      swimlanes: compiled.swimlanes,
      trackingPlan: compiled.trackingPlan,
      dataModel: compiled.dataModel,
      backendDelivery: compiled.backendDelivery,
      fiveLayers: compiled.fiveLayers,
    });
  }
  const focus = audits.find((item) => item.role === "本品") || audits[0];
  if (focus?.swimlanes?.length) {
    px.designLogic = focus.designLogic?.length ? focus.designLogic : px.designLogic;
    px.interactionLogic = focus.interactionLogic?.length ? focus.interactionLogic : px.interactionLogic;
    px.swimlanes = focus.swimlanes;
    px.trackingPlan = focus.trackingPlan;
    px.dataModel = focus.dataModel;
    px.backendDelivery = focus.backendDelivery;
  }
  if (audits.some((item) => evidencedScreens(item).length)) {
    px.comparison = {
      dimensions: ["入口与信息架构", "任务编排", "状态与失败恢复", "结果交付与治理"],
      cells: audits.flatMap((audit) => ([
        { dimension: "入口与信息架构", product: audit.competitorName, focus: audit.designFocus || audit.role, note: audit.designLogic?.[0] || "待从侧栏验证" },
        { dimension: "任务编排", product: audit.competitorName, focus: audit.designFocus || audit.role, note: audit.interactionLogic?.[0] || "待从输入区验证" },
        { dimension: "状态与失败恢复", product: audit.competitorName, focus: "交互侧重点", note: audit.interactionLogic?.[1] || audit.weaknesses?.[0] || "待从执行页验证" },
        { dimension: "结果交付与治理", product: audit.competitorName, focus: audit.designFocus || "待验证", note: audit.strengths?.[0] || "待从结果页验证" },
      ])),
    };
  }
  return analysis;
}
