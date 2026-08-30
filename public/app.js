import { compileUiAuditFromScreens } from "./ui-audit.js";
import { compileBakeoff, formatRunCell } from "./bakeoff.js";

const DIMENSIONS = [
  ["marketFit", "市场匹配"],
  ["productExperience", "产品体验"],
  ["aiCapability", "AI 能力"],
  ["trustSafety", "信任安全"],
  ["growth", "增长"],
  ["monetization", "商业化"],
  ["costEfficiency", "成本效率"],
  ["ecosystem", "生态"],
  ["innovation", "创新"],
];

const WEIGHTS = { marketFit: 12, productExperience: 14, aiCapability: 18, trustSafety: 10, growth: 10, monetization: 12, costEfficiency: 10, ecosystem: 7, innovation: 7 };
const COLORS = ["#ff6b35", "#2e8b77", "#4d7eaa", "#d99b31", "#8c6baa", "#cb5d57"];

const state = {
  analysis: null,
  health: null,
  projects: [],
  uiCompetitorIndex: 0,
  uiScreenIndex: 0,
  competitors: [
    { name: "", url: "", role: "本品" },
    { name: "", url: "", role: "直接竞品" },
    { name: "", url: "", role: "直接竞品" },
  ],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const score = (value) => clamp(Number(value) || 0, 0, 10);
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const safeUrl = (value) => {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; } catch { return ""; }
};
const safeImageUrl = (value) => {
  const text = String(value || "").trim();
  if (/^\/(?:assets|generated\/ui)\/[a-zA-Z0-9._/-]+$/u.test(text)) return text;
  return safeUrl(text);
};
const sourceTypeLabel = (value) => ({ actual_app_ui: "应用内直接截图", official_tutorial: "官方教程实机界面", secondary_walkthrough: "第三方实操/场景文", video_walkthrough: "教学视频实机取帧", user_supplied: "用户提供实机界面", unverified: "尚未核验" }[value] || "尚未核验");
const listHtml = (items, empty = "待验证") => {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  return values.length ? `<ul>${values.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : `<p class="empty-mini">${esc(empty)}</p>`;
};

function bakeoffTableHtml(bakeoff) {
  const tasks = bakeoff?.tasks || [];
  const products = [...new Set(tasks.flatMap((task) => (task.runs || []).map((run) => run.product)))];
  if (!tasks.length || !products.length) return '<p class="empty-mini">尚未建立黄金任务评测集。</p>';
  return `<table class="data-table bakeoff-table"><thead><tr><th>黄金任务</th>${products.map((name) => `<th>${esc(name)}</th>`).join("")}</tr></thead><tbody>${tasks.map((task) => `<tr><th><strong>${esc(task.name)}</strong><br><small>${esc(task.success || "")}</small></th>${products.map((name) => {
    const run = (task.runs || []).find((item) => item.product === name) || { status: "not_run" };
    const cell = formatRunCell(run);
    return `<td class="bakeoff-cell ${esc(run.status || "not_run")}${run.publicPath?.channel && run.publicPath.channel !== "none" ? " has-path" : ""}"><strong>${esc(cell.title)}</strong><br><small>${esc(cell.detail)}</small>${run.publicPath?.url ? `<br><a class="bakeoff-path-link" href="${esc(safeUrl(run.publicPath.url))}" target="_blank" rel="noreferrer">打开公开路径</a>` : ""}</td>`;
  }).join("")}</tr>`).join("")}</tbody></table>`;
}

function bakeoffTaskCards(bakeoff) {
  const tasks = bakeoff?.tasks || [];
  if (!tasks.length) return "";
  return tasks.map((task) => `<article class="ui-bakeoff-task"><code>${esc(task.id)}</code><h4>${esc(task.name)}</h4><p>${esc(task.job)}</p><small>材料：${esc(task.materials)}<br>交差标准：${esc(task.success)}</small></article>`).join("");
}

function renderBakeoffTables() {
  const bakeoff = state.analysis?.bakeoff;
  const summary = bakeoff?.summary || "尚未建立黄金任务评测集。";
  const table = bakeoffTableHtml(bakeoff);
  if ($("#bakeoffSummary")) $("#bakeoffSummary").textContent = summary;
  if ($("#dashboardBakeoff")) $("#dashboardBakeoff").innerHTML = table;
  if ($("#uiBakeoffSummary")) $("#uiBakeoffSummary").textContent = summary;
  if ($("#uiBakeoffTable")) $("#uiBakeoffTable").innerHTML = table;
  if ($("#uiBakeoffTasks")) $("#uiBakeoffTasks").innerHTML = bakeoffTaskCards(bakeoff);
}

function toast(message, error = false) {
  const el = $("#toast");
  el.textContent = message;
  el.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.className = "toast"; }, 4200);
}

function loading(show, title = "正在处理", text = "请稍候…") {
  $("#loadingOverlay").classList.toggle("hidden", !show);
  $("#loadingTitle").textContent = title;
  $("#loadingText").textContent = text;
  const analyzeBtn = $("#analyzeBtn");
  if (analyzeBtn) analyzeBtn.disabled = show;
}

let analyzing = false;

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("请求已取消");
    throw new Error("连不上本地分析服务。请刷新页面，确认地址是 http://127.0.0.1:4173，重新填入 DeepSeek Key 后再点一次「开始调研」。");
  }
  const type = response.headers.get("content-type") || "";
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    if (type.includes("json")) {
      const payload = await response.json();
      message = payload?.error?.message || message;
    }
    throw new Error(message);
  }
  return type.includes("json") ? response.json() : response;
}

async function refreshHealth() {
  try {
    const payload = await api("/api/health");
    state.health = payload;
    $("#statusDot").classList.toggle("online", payload.connectionVerified);
    $("#modelStatus").textContent = payload.connectionVerified
      ? `${payload.model} · 已验证连接`
      : payload.keyConfigured
        ? `${payload.model} · 已配置待验证`
        : `${payload.model} · 待输入密钥`;
    $("#baseUrl").value = payload.baseUrl;
    $("#modelName").value = payload.model;
    if ($("#exportDestination")) $("#exportDestination").textContent = `默认保存到：${payload.reportsRoot}`;
  } catch (error) {
    $("#modelStatus").textContent = "本地服务不可用";
    toast(error.message, true);
  }
}

function renderCompetitorInputs() {
  $("#competitorList").innerHTML = state.competitors.map((item, index) => `
    <div class="competitor-row" data-index="${index}">
      <input data-field="name" value="${esc(item.name)}" placeholder="${index === 0 ? "目标产品名称" : "竞品名称"}" aria-label="竞品名称">
      <input data-field="url" value="${esc(item.url)}" placeholder="官网或证据 URL（可选）" aria-label="竞品 URL">
      <select data-field="role" aria-label="竞品角色">
        ${["本品", "直接竞品", "间接竞品", "标杆"].map((role) => `<option ${item.role === role ? "selected" : ""}>${role}</option>`).join("")}
      </select>
      <button class="remove-row" data-remove="${index}" aria-label="删除竞品">×</button>
    </div>
  `).join("");
  $$(".competitor-row input, .competitor-row select").forEach((input) => {
    input.addEventListener("input", (event) => {
      const row = event.target.closest(".competitor-row");
      state.competitors[Number(row.dataset.index)][event.target.dataset.field] = event.target.value;
    });
  });
  $$('[data-remove]').forEach((button) => button.addEventListener("click", () => {
    if (state.competitors.length <= 1) return toast("至少保留一个分析对象", true);
    state.competitors.splice(Number(button.dataset.remove), 1);
    renderCompetitorInputs();
  }));
}

function collectBrief() {
  const product = $("#briefProduct").value.trim();
  const autoResearch = $("#autoResearch").checked;
  const autoDiscover = $("#autoDiscover").checked;
  const competitors = state.competitors
    .map((item, index) => ({
      name: item.name.trim() || (index === 0 && product ? product : ""),
      url: item.url.trim(),
      role: item.role,
    }))
    .filter((item) => item.name);
  if (!product && !competitors.length) throw new Error("请至少填写目标产品或一个竞品名称");
  if (competitors.length < 2 && !(autoResearch && autoDiscover)) throw new Error("请至少填写本品和一个竞品，或开启自动联网调研与自动发现竞品");
  const evidenceNotes = $("#sourceNotes").value.trim();
  return {
    meta: {
      title: $("#briefTitle").value.trim() || "AI 产品竞品分析",
      product: product || competitors[0].name,
      objective: $("#briefObjective").value.trim(),
      decisionQuestion: $("#briefDecision").value.trim(),
      audience: $("#briefAudience").value.trim(),
      date: new Date().toISOString().slice(0, 10),
    },
    competitors,
    autoResearch,
    autoDiscover,
    evidenceNotes,
    evidenceInstruction: autoResearch
      ? "主动搜索并核对公开资料；商业结论核对官网与定价，UI 结论只接受教程或实操中的应用内界面，每项关键结论必须附真实 URL。"
      : "不访问互联网；只使用用户提供的证据，无法确认的内容明确标记待验证。",
  };
}

function setView(view) {
  $$(".view").forEach((section) => section.classList.toggle("active", section.id === `view-${view}`));
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const titles = { brief: "定义分析任务", dashboard: "竞争态势看板", deepdive: "深度分析", "ui-analysis": "前端 UI 产品审计", evidence: "证据与评分审计", roadmap: "建议与行动路线" };
  $("#pageTitle").textContent = titles[view] || "AI 竞品分析";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function weightedScore(competitor) {
  const total = Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + score(competitor?.scores?.[key]) * weight, 0);
  return Math.round(total / 10) / 10;
}

function colorForScore(value) {
  if (value >= 8) return "#2e8b77";
  if (value >= 6.5) return "#4d7eaa";
  if (value >= 5) return "#d99b31";
  return "#cb5d57";
}

function renderScoreBars() {
  const competitors = state.analysis.competitors || [];
  $("#scoreBars").innerHTML = competitors.map((item) => {
    item.score = weightedScore(item);
    return `<div class="score-row"><span class="score-name" title="${esc(item.name)}">${esc(item.name)}</span><div class="score-track"><div class="score-fill" style="width:${item.score * 10}%;background:${colorForScore(item.score)}"></div></div><span class="score-value">${item.score.toFixed(1)}</span></div>`;
  }).join("") || "<p>暂无竞品评分。</p>";
}

function heatColor(value) {
  const lightness = 96 - score(value) * 4.6;
  return `hsl(162 39% ${lightness}%)`;
}

function renderHeatmap() {
  const a = state.analysis;
  const head = `<thead><tr><th>竞品</th>${DIMENSIONS.map(([, label]) => `<th>${esc(label)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${(a.competitors || []).map((competitor, row) => `<tr><td>${esc(competitor.name)}</td>${DIMENSIONS.map(([key, label]) => {
    const value = score(competitor.scores?.[key]);
    const rationale = competitor.scoreRationales?.[key] || {};
    const evidenceIds = Array.isArray(rationale.evidenceIds) ? rationale.evidenceIds : [];
    const title = `${label}：${rationale.rationale || "待补充评分依据"}｜证据：${evidenceIds.join("、") || "无（评分上限 5）"}`;
    return `<td><input type="number" min="0" max="10" step="0.1" value="${value.toFixed(1)}" data-score-row="${row}" data-score-key="${key}" data-score-evidence="${evidenceIds.length}" title="${esc(title)}" style="background:${heatColor(value)}" aria-label="${esc(competitor.name)} ${key} 评分"></td>`;
  }).join("")}</tr>`).join("")}</tbody>`;
  $("#heatmap").innerHTML = head + body;
  $$('[data-score-row]').forEach((input) => input.addEventListener("change", () => {
    const requested = score(input.value);
    const value = requested > 5 && Number(input.dataset.scoreEvidence) === 0 ? 5 : requested;
    if (value !== requested) toast("该维度没有有效证据引用，评分已限制为 5.0", true);
    input.value = value.toFixed(1);
    input.style.background = heatColor(value);
    state.analysis.competitors[Number(input.dataset.scoreRow)].scores[input.dataset.scoreKey] = value;
    renderScoreBars();
    renderPositionMap();
    updateSummaryMetrics();
    persist();
  }));
}

function renderPositionMap() {
  const competitors = state.analysis.competitors || [];
  const bubbles = competitors.map((item, index) => {
    const x = 8 + score(item.scores?.aiCapability) * 8.4;
    const y = 8 + score(item.scores?.productExperience) * 8.4;
    const size = 45 + score(item.scores?.marketFit) * 5;
    return `<div class="bubble" title="${esc(item.name)}｜AI ${score(item.scores?.aiCapability).toFixed(1)}｜体验 ${score(item.scores?.productExperience).toFixed(1)}" style="left:${x}%;bottom:${y}%;width:${size}px;height:${size}px;background:${COLORS[index % COLORS.length]}"><span>${esc(item.name)}</span></div>`;
  }).join("");
  $("#positionMap").innerHTML = `<span class="axis-label axis-x-left">AI 能力低</span><span class="axis-label axis-x-right">AI 能力高</span><span class="axis-label axis-y-top">体验深</span><span class="axis-label axis-y-bottom">体验浅</span>${bubbles}`;
}

function updateSummaryMetrics() {
  const a = state.analysis;
  const self = a.competitors?.find((item) => item.role === "本品") || a.competitors?.[0];
  $("#competitorCount").textContent = a.competitors?.length || 0;
  $("#evidenceCount").textContent = a.evidence?.length || 0;
  $("#averageScore").textContent = self ? weightedScore(self).toFixed(1) : "0.0";
}

function renderDashboard() {
  const a = state.analysis;
  $("#dashboardEmpty").classList.toggle("hidden", Boolean(a));
  $("#dashboardContent").classList.toggle("hidden", !a);
  if (!a) return;
  $("#verdictHeadline").textContent = a.executiveSummary?.headline || "待形成结论";
  $("#verdictText").textContent = a.executiveSummary?.verdict || "";
  const research = a.research || {};
  const researchLabels = {
    web_search: ["联网调研", "已检索公开网络并核对来源"],
    demo: ["演示数据", "当前结果用于功能体验"],
    manual: ["离线分析", "仅依据用户提供的材料"],
  };
  const [modeLabel, modeHint] = researchLabels[research.mode] || researchLabels.manual;
  const statusLabel = research.status === "completed" ? "已完成" : research.status === "partial" ? "部分完成" : "未开始";
  const searchedAt = research.searchedAt ? new Date(research.searchedAt).toLocaleString("zh-CN", { hour12: false }) : "—";
  $("#researchBand").innerHTML = `
    <div class="research-status"><span class="research-pulse ${esc(research.status || "not_started")}"></span><div><strong>${esc(modeLabel)} · ${esc(statusLabel)}</strong><small>${esc(modeHint)}</small></div></div>
    <div class="research-metrics"><span><b>${Number(research.searchCalls) || 0}</b>搜索动作</span><span><b>${a.evidence?.length || 0}</b>证据来源</span><span><b>${esc(searchedAt)}</b>完成时间</span></div>
    <p>${esc(research.summary || "尚未记录调研摘要")}${research.gaps?.length ? ` <em>待补：${esc(research.gaps.join("；"))}</em>` : ""}</p>`;
  $("#northStar").textContent = a.northStar?.metric || "待定义";
  $("#northStarWhy").textContent = a.northStar?.rationale || "";
  $("#guardrails").innerHTML = (a.northStar?.guardrails || []).map((item) => `<span class="tag">${esc(item)}</span>`).join("");
  $("#marketStage").textContent = a.market?.stage || "待判断";
  $("#marketTrend").textContent = a.market?.trend || "";
  $("#marketSignals").innerHTML = [
    ["规模信号", a.market?.sizeSignal], ["里程碑", a.market?.milestone], ["下一转折", a.market?.nextInflection],
  ].map(([label, value]) => `<div class="signal-item"><small>${label}</small><span>${esc(value || "待验证")}</span></div>`).join("");
  $("#rockets").innerHTML = [
    ["01", "提高访问", a.economics?.acquisition], ["02", "提高 ARPU", a.economics?.arpu], ["03", "提高回访", a.economics?.retention],
  ].map(([no, title, value]) => `<div class="rocket"><b>${no}</b><h4>${title}</h4><p>${esc(value || "待验证")}</p></div>`).join("");
  $("#insightList").innerHTML = (a.executiveSummary?.insights || []).map((item) => `<li>${esc(item)}</li>`).join("") || "<li>待形成关键洞察</li>";
  $("#actionList").innerHTML = (a.executiveSummary?.actions || []).map((item) => `<li>${esc(item)}</li>`).join("") || "<li>待形成建议动作</li>";
  renderScoreBars();
  renderHeatmap();
  renderPositionMap();
  renderBakeoffTables();
  updateSummaryMetrics();
}

function renderDeepDive() {
  const a = state.analysis;
  $("#deepDiveEmpty").classList.toggle("hidden", Boolean(a));
  $("#deepDiveContent").classList.toggle("hidden", !a);
  if (!a) return;
  const needs = a.userNeeds || {};
  const personas = (needs.personas || []).map((item) => `
    <article class="persona-card"><span class="card-kicker">PERSONA</span><h4>${esc(item.name)}</h4><p>${esc(item.description)}</p><strong>目标</strong>${listHtml(item.goals)}<strong>痛点</strong>${listHtml(item.pains)}<small>证据 ${esc(item.evidenceIds?.join("、") || "待补")}</small></article>`);
  const scenarios = (needs.scenarios || []).map((item) => `
    <article class="persona-card scenario-card"><span class="card-kicker">SCENARIO</span><h4>${esc(item.name)}</h4><dl><dt>触发</dt><dd>${esc(item.trigger)}</dd><dt>任务</dt><dd>${esc(item.task)}</dd><dt>结果</dt><dd>${esc(item.outcome)}</dd></dl><small>证据 ${esc(item.evidenceIds?.join("、") || "待补")}</small></article>`);
  $("#personaCards").innerHTML = [...personas, ...scenarios].join("") || "<p class=\"empty-mini\">尚未形成用户画像与场景。</p>";
  const kano = needs.kano || {};
  $("#kanoGrid").innerHTML = [
    ["基础型", "MUST-BE", kano.mustBe], ["期望型", "PERFORMANCE", kano.performance],
    ["兴奋型", "DELIGHTERS", kano.delighters], ["无差异", "INDIFFERENT", kano.indifferent],
  ].map(([label, en, items]) => `<article class="kano-card"><span>${en}</span><h4>${label}</h4>${listHtml(items)}</article>`).join("");
  $("#hmwList").innerHTML = `<strong>HOW MIGHT WE</strong>${listHtml(needs.hmw, "待提出机会问题")}`;

  const px = a.productExperience || {};
  $("#designLogicGrid").innerHTML = [
    ["产品设计逻辑", px.designLogic], ["交互设计逻辑", px.interactionLogic],
  ].map(([title, items]) => `<article class="logic-card"><h4>${esc(title)}</h4>${listHtml(items, "待补充界面证据")}</article>`).join("");
  $("#interfaceAuditGrid").innerHTML = (px.interfaceAudit || []).map((item, index) => `<article class="interface-audit-card">
    <span class="audit-no">${String(index + 1).padStart(2, "0")}</span><h4>${esc(item.screen)}</h4><p>${esc(item.purpose)}</p>
    <dl><dt>入口</dt><dd>${esc(item.entry)}</dd><dt>主操作</dt><dd>${esc(item.primaryAction)}</dd><dt>反馈</dt><dd>${esc(item.feedback)}</dd><dt>摩擦</dt><dd>${esc(item.friction)}</dd></dl>
    <strong>截图标注重点</strong><p>${esc(item.annotation)}</p><small>证据 ${esc(item.evidenceIds?.join("、") || "待补")}</small>
  </article>`).join("") || '<p class="empty-mini">尚未形成逐屏界面审计。</p>';
  const laneRows = px.swimlanes || [];
  $("#swimlaneTable").innerHTML = `<table class="data-table"><thead><tr><th>阶段</th><th>用户</th><th>前端</th><th>Agent</th><th>运营 / 管理员</th><th>数据</th></tr></thead><tbody>${laneRows.map((item) => `<tr><td><strong>${esc(item.stage)}</strong></td><td>${esc(item.user)}</td><td>${esc(item.frontend)}</td><td>${esc(item.agent)}</td><td>${esc(item.operations)}</td><td>${esc(item.data)}</td></tr>`).join("") || '<tr><td colspan="6">尚未形成用户泳道。</td></tr>'}</tbody></table>`;

  const layerLabels = [["strategy", "战略层"], ["scope", "范围层"], ["structure", "结构层"], ["framework", "框架层"], ["surface", "表现层"]];
  $("#competitorDeepDives").innerHTML = (a.competitors || []).map((item) => {
    const url = safeUrl(item.url);
    const ai = item.aiProfile || {};
    const layerHtml = layerLabels.map(([key, label]) => {
      const value = item.fiveLayers?.[key];
      const fromUi = ["structure", "framework", "surface"].includes(key) && Array.isArray(value) && value.length;
      return `<div class="layer-cell">${fromUi ? `<em class="layer-from-ui">界面反推</em>` : ""}<span>${label}</span>${Array.isArray(value) ? listHtml(value) : `<p>${esc(value || "待验证")}</p>`}</div>`;
    }).join("");
    return `<article class="competitor-deep-card">
      <header class="deep-card-head"><div><span>${esc(item.role || "竞品")}</span><h3>${esc(item.name)}</h3><p>${esc(item.positioning)}</p></div>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">访问官网 ↗</a>` : ""}</header>
      <div class="profile-grid"><div><strong>目标用户</strong>${listHtml(item.targetUsers)}</div><div><strong>核心任务</strong>${listHtml(item.coreJobs)}</div><div><strong>关键旅程</strong>${listHtml(item.coreJourney)}</div><div><strong>定价与模式</strong><p>${esc(item.pricing || "待验证")}<br>${esc(item.businessModel || "待验证")}</p></div></div>
      <div class="five-layer-grid">${layerHtml}</div>
      <div class="ai-profile"><strong>AI 能力画像</strong><div class="profile-grid"><p><b>模型策略</b>${esc(ai.modelStrategy)}</p><p><b>质量 / 时延</b>${esc(ai.quality)} / ${esc(ai.latency)}</p><p><b>可靠 / 隐私</b>${esc(ai.reliability)} / ${esc(ai.privacy)}</p><p><b>数据飞轮</b>${esc(ai.dataFlywheel)}</p><p><b>集成 / 成本</b>${esc(ai.integration)} / ${esc(ai.cost)}</p><p><b>模态</b>${esc(ai.modalities?.join("、") || "待验证")}</p></div></div>
      <div class="swot-grid"><div><strong>优势</strong>${listHtml(item.strengths)}</div><div><strong>短板</strong>${listHtml(item.weaknesses)}</div><div><strong>机会</strong>${listHtml(item.opportunities)}</div><div><strong>威胁</strong>${listHtml(item.threats)}</div></div>
    </article>`;
  }).join("") || "<p class=\"empty-mini\">尚无竞品拆解。</p>";

  const systemLabels = [["user", "用户数据系统"], ["growth", "增长数据系统"], ["revenue", "营收数据系统"]];
  $("#dataSystemsGrid").innerHTML = systemLabels.map(([key, label]) => {
    const system = a.dataSystems?.[key] || {};
    return `<article class="data-system-card"><span>${esc(label)}</span><h4>${esc(system.goal || "待定义")}</h4><strong>核心指标</strong>${listHtml(system.metrics)}<strong>漏斗</strong>${listHtml(system.funnel)}<strong>缺口</strong>${listHtml(system.gaps)}</article>`;
  }).join("");
  const instrumentation = a.dataSystems?.instrumentation || [];
  const tracking = px.trackingPlan || [];
  $("#trackingPlanTable").innerHTML = `<table class="data-table"><thead><tr><th>事件</th><th>触发条件</th><th>关键属性</th><th>指标</th><th>产品决策</th></tr></thead><tbody>${tracking.map((item) => `<tr><td><code>${esc(item.event)}</code></td><td>${esc(item.trigger)}</td><td>${esc(item.properties?.join("、") || "待定义")}</td><td>${esc(item.metric)}</td><td>${esc(item.decision)}</td></tr>`).join("") || '<tr><td colspan="5">尚未定义产品埋点字典。</td></tr>'}</tbody></table>`;
  const dataModel = px.dataModel || {};
  $("#dataModelGrid").innerHTML = `<div class="model-principles"><strong>建模原则</strong>${listHtml(dataModel.principles, "待定义")}</div>${(dataModel.entities || []).map((item) => `<article class="entity-card"><code>${esc(item.name)}</code><h4>${esc(item.purpose)}</h4><strong>关键字段</strong><p>${esc(item.keyFields?.join(" · ") || "待定义")}</p><strong>关系</strong>${listHtml(item.relations)}<small>${esc(item.retention)}</small></article>`).join("") || '<p class="empty-mini">尚未推导数据库实体。</p>'}`;
  $("#instrumentationTable").innerHTML = `<table class="data-table"><thead><tr><th>事件</th><th>目的</th><th>何时</th><th>何处</th><th>负责人</th><th>如何使用</th></tr></thead><tbody>${instrumentation.map((item) => `<tr><td><code>${esc(item.event)}</code></td><td>${esc(item.purpose)}</td><td>${esc(item.when)}</td><td>${esc(item.where)}</td><td>${esc(item.owner)}</td><td>${esc(item.usage)}</td></tr>`).join("") || '<tr><td colspan="6">尚未定义埋点方案。</td></tr>'}</tbody></table>`;
}

function confidenceClass(value) {
  return value === "高" ? "high" : value === "低" ? "low" : "medium";
}

function renderEvidence() {
  const a = state.analysis;
  $("#evidenceEmpty").classList.toggle("hidden", Boolean(a));
  $("#evidenceContent").classList.toggle("hidden", !a);
  if (!a) return;
  const evidence = a.evidence || [];
  const linked = evidence.filter((item) => safeUrl(item.url)).length;
  const high = evidence.filter((item) => item.confidence === "高").length;
  const stale = evidence.filter((item) => item.date && Date.now() - new Date(item.date).getTime() > 365 * 86400000).length;
  const coverage = evidence.length ? Math.round((linked / evidence.length) * 100) : 0;
  const audit = a.audit || {};
  const adjusted = (audit.adjustedScores?.length || 0) + (audit.adjustedOpportunities?.length || 0);
  const invalid = audit.invalidEvidenceReferences?.length || 0;
  $("#auditStrip").innerHTML = [
    [evidence.length, "证据总数"], [`${coverage}%`, "可点击来源"], [high, "高置信度"], [stale, "超过一年"],
    [`${audit.scoreEvidenceCoverage ?? 0}%`, "评分证据覆盖"], [`${audit.opportunityEvidenceCoverage ?? 0}%`, "机会证据覆盖"],
    [adjusted, "自动降级"], [invalid, "无效引用"],
  ].map(([value, label]) => `<div class="audit-metric"><span>${value}</span><small>${label}</small></div>`).join("");
  const findings = [];
  if (audit.adjustedScores?.length) findings.push(`${audit.adjustedScores.length} 个无证据高分已自动降到 5.0。`);
  if (audit.adjustedOpportunities?.length) findings.push(`${audit.adjustedOpportunities.length} 个无证据机会的信心已自动降到 5.0。`);
  if (invalid) findings.push(`${invalid} 个不存在的证据 ID 已从引用中移除。`);
  if (audit.renamedEvidenceIds?.length) findings.push(`${audit.renamedEvidenceIds.length} 个重复证据 ID 已自动改为唯一 ID。`);
  if (audit.unreferencedEvidenceIds?.length) findings.push(`未被评分或机会引用的证据：${audit.unreferencedEvidenceIds.join("、")}。`);
  $("#auditFindings").classList.toggle("hidden", !findings.length);
  $("#auditFindings").innerHTML = findings.length ? `<ul>${findings.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : "";
  const referenceCounts = new Map();
  const addReferences = (ids) => (ids || []).forEach((id) => referenceCounts.set(id, (referenceCounts.get(id) || 0) + 1));
  (a.competitors || []).forEach((competitor) => Object.values(competitor.scoreRationales || {}).forEach((item) => addReferences(item.evidenceIds)));
  (a.opportunities || []).forEach((item) => addReferences(item.evidenceIds));
  $("#evidenceTable").innerHTML = evidence.map((item) => {
    const url = safeUrl(item.url);
    return `<tr><td>${esc(item.id || "—")}</td><td>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(item.title || url)} ↗</a>` : esc(item.title || "待补充")}</td><td>${esc(item.claim || "待补充")}</td><td>${esc(item.date || "日期待补")}<br><small>${esc(item.type || "类型待补")}</small></td><td><span class="confidence ${confidenceClass(item.confidence)}">${esc(item.confidence || "中")}</span></td><td>${referenceCounts.get(item.id) || 0} 次</td></tr>`;
  }).join("") || `<tr><td colspan="6">尚无证据。当前结论只能作为待验证假设。</td></tr>`;
  $("#limitations").innerHTML = `<ul>${(a.limitations || ["未记录局限。"]).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

function renderUiAnalysis() {
  const a = state.analysis;
  const px = a?.productExperience || {};
  const hasUi = Boolean(a && ((px.interfaceAudit || []).length || (px.designLogic || []).length || (px.swimlanes || []).length));
  $("#uiAnalysisEmpty").classList.toggle("hidden", hasUi);
  $("#uiAnalysisContent").classList.toggle("hidden", !hasUi);
  if (!hasUi) return;

  const productAudits = (px.competitorAudits || []).length ? px.competitorAudits : [{ competitorName: a.meta?.product || "本品", role: "本品", visualResearch: px.visualResearch, designLogic: px.designLogic, interactionLogic: px.interactionLogic, interfaceAudit: px.interfaceAudit }];
  state.uiCompetitorIndex = clamp(state.uiCompetitorIndex, 0, Math.max(0, productAudits.length - 1));
  const selected = productAudits[state.uiCompetitorIndex] || productAudits[0];
  $("#uiProductTabs").innerHTML = productAudits.map((item, index) => `<button class="ui-product-tab ${index === state.uiCompetitorIndex ? "active" : ""}" data-ui-product="${index}">${esc(item.competitorName)}<small>${esc(item.role || "竞品")}</small></button>`).join("");
  $$('[data-ui-product]').forEach((button) => button.addEventListener("click", () => { state.uiCompetitorIndex = Number(button.dataset.uiProduct); state.uiScreenIndex = 0; renderUiAnalysis(); }));
  const audits = selected.interfaceAudit || [];
  const evidencedAudits = audits.filter((item) => safeImageUrl(item.imageUrl) && item.sourceType !== "unverified");
  state.uiScreenIndex = clamp(state.uiScreenIndex || 0, 0, Math.max(0, evidencedAudits.length - 1));
  const activeAudit = evidencedAudits[state.uiScreenIndex];
  const image = safeImageUrl(activeAudit?.imageUrl);
  const visual = selected.visualResearch || px.visualResearch || {};
  $("#uiEvidenceFigure").innerHTML = image
    ? `<div class="ui-annotated-image"><div class="ui-annotated-frame"><img src="${esc(image)}" alt="${esc(activeAudit.screen || "实际应用界面证据")}">${(activeAudit.callouts || []).map((pin) => `<button class="ui-pin" style="left:${Number(pin.x) || 12}%;top:${Number(pin.y) || 16}%" title="${esc(pin.insight || pin.label)}">${esc(pin.n)}</button>`).join("")}</div></div>
       ${(activeAudit.callouts || []).length ? `<ol class="ui-callout-legend">${activeAudit.callouts.map((pin) => `<li><b>${esc(pin.n)}</b><span>${esc(pin.label)}</span>${pin.insight ? `<small>${esc(pin.insight)}</small>` : ""}</li>`).join("")}</ol>` : ""}
       <div class="ui-evidence-meta"><span>${esc(activeAudit.usageStage || "使用阶段待核验")}</span><strong>${esc(activeAudit.screen)}</strong><em>${esc(sourceTypeLabel(activeAudit.sourceType))}</em>${activeAudit.videoTimestamp ? `<i>取帧 ${esc(activeAudit.videoTimestamp)}</i>` : ""}${safeUrl(activeAudit.sourceUrl) ? `<a href="${esc(safeUrl(activeAudit.sourceUrl))}" target="_blank" rel="noopener noreferrer">查看${activeAudit.sourceType === "video_walkthrough" ? "视频" : "截图"}来源 ↗</a>` : ""}</div>
       <div class="ui-evidence-thumbs">${evidencedAudits.map((item, index) => `<button class="${index === state.uiScreenIndex ? "active" : ""}" data-ui-screen="${index}"><img src="${esc(safeImageUrl(item.imageUrl))}" alt=""><span>${esc(item.usageStage)} · ${esc(item.screen)}</span></button>`).join("")}</div>
       <p class="ui-capture-status">${esc(visual.message || `已取得 ${evidencedAudits.length} 张实际使用流程界面；切换缩略图逐步核验。`)}</p>`
    : `<div class="ui-evidence-placeholder"><strong>尚未取得可核验的应用内界面</strong><p>${esc(visual.message || "官网首屏和宣传图不计入 UI 证据；需要继续寻找工作台、任务执行或结果交付截图、官方教程和 YouTube／Bilibili 实操视频。")}</p><button class="btn btn-dark" id="captureUiEvidence">检索实际使用界面</button></div>`;
  $$('[data-ui-screen]').forEach((button) => button.addEventListener("click", () => { state.uiScreenIndex = Number(button.dataset.uiScreen); renderUiAnalysis(); }));
  $("#captureUiEvidence")?.addEventListener("click", captureUiEvidence);
  $("#uiScreenAudit").innerHTML = audits.slice(0, 12).map((item, index) => `<article class="ui-screen-card ${item.sourceType === "unverified" ? "unverified" : ""}"><b>${String(index + 1).padStart(2, "0")}</b><h4>${esc(item.usageStage || "待验证")} · ${esc(item.screen)}</h4><p>${esc(item.annotation)}</p><dl><dt>证据</dt><dd>${esc(sourceTypeLabel(item.sourceType))}</dd><dt>入口</dt><dd>${esc(item.entry)}</dd><dt>主操作</dt><dd>${esc(item.primaryAction)}</dd><dt>反馈</dt><dd>${esc(item.feedback)}</dd><dt>摩擦</dt><dd>${esc(item.friction)}</dd></dl></article>`).join("") || '<p class="empty-mini">尚未形成逐屏审计。</p>';

  $("#uiLogicColumns").innerHTML = [
    [`${selected.competitorName} · 用户怎样开始和完成任务`, selected.designLogic?.length ? selected.designLogic : px.designLogic],
    [`${selected.competitorName} · 运行中怎样反馈，失败后怎样继续`, selected.interactionLogic?.length ? selected.interactionLogic : px.interactionLogic],
  ].map(([title, items]) => `<article class="ui-logic-card"><h4>${esc(title)}</h4><ol>${(items || []).slice(0, 3).map((item) => `<li>${esc(item)}</li>`).join("") || "<li>待补充</li>"}</ol></article>`).join("")
    + `<article class="ui-focus-banner"><span>${esc(selected.role || "竞品")}</span><strong>一句话看懂：${esc(selected.designFocus || "待从界面验证")}</strong><div class="ui-swot-mini"><div><b>做得好的地方</b>${listHtml(selected.strengths, "待验证")}</div><div><b>容易卡住的地方</b>${listHtml(selected.weaknesses, "待验证")}</div></div></article>`
    + ((selected.settings || []).length ? `<div class="ui-settings-grid">${selected.settings.slice(0, 8).map((item) => `<article class="ui-setting-card"><code>${esc(item.name)}</code><h4>${esc(item.purpose)}</h4><p>默认：${esc(item.defaultValue)}</p><p>用户：${esc(item.userImpact)}</p><small>商业：${esc(item.businessIntent)}</small></article>`).join("")}</div>` : "");
  const layers = selected.fiveLayers || {};
  const layerLabels = [["structure", "用户从哪里开始"], ["framework", "页面怎样帮助用户操作"], ["surface", "用户实际能看到什么"]];
  if ($("#uiFiveLayers")) {
    $("#uiFiveLayers").innerHTML = layerLabels.map(([key, label]) => {
      const value = layers[key];
      return `<div class="layer-cell"><em class="layer-from-ui">界面反推</em><span>${label}</span>${listHtml(value, "该产品还没有可核验截图，无法反推这一层")}</div>`;
    }).join("");
  }
  const docsMap = selected.docsMap || {};
  if ($("#uiDocsMap")) {
    const platforms = docsMap.platforms || [];
    const modules = docsMap.modules || [];
    const groups = [];
    for (const item of modules) {
      const group = groups.find((entry) => entry.name === (item.group || "功能"));
      if (group) group.items.push(item);
      else groups.push({ name: item.group || "功能", items: [item] });
    }
    $("#uiDocsMap").innerHTML = (platforms.length || modules.length)
      ? `<div class="ui-docs-map">${platforms.length ? `<div class="ui-platform-row"><span>覆盖端</span>${platforms.map((item) => `<em class="ui-platform-chip ${esc(item.channel || "")}">${esc(item.name)}</em>`).join("")}</div>` : ""}${groups.map((group) => `<div class="ui-module-group"><b>${esc(group.name)}</b><div>${group.items.map((item) => `<span>${esc(item.name)}</span>`).join("")}</div></div>`).join("")}${docsMap.notes?.length ? `<p class="ui-docs-note">${esc(docsMap.notes[0])}</p>` : ""}</div>`
      : "";
  }
  const stageCopy = {
    进入: "侧栏、模式与主工作台",
    发起: "输入框、附件与发送",
    配置: "工作空间、技能或连接器",
    执行: "进度、监控与停止",
    交付: "产物预览、修订与复跑",
    治理: "权限确认与风险说明",
  };
  const evidencedStages = [...new Set(evidencedAudits.flatMap((item) => String(item.usageStage || "").split(/[/、]/u).map((part) => part.trim()).filter((part) => stageCopy[part])))];
  const states = (evidencedStages.length ? evidencedStages : Object.keys(stageCopy)).slice(0, 6).map((title) => [title, stageCopy[title]]);
  $("#uiStateFlow").innerHTML = states.map(([title, copy]) => `<article class="ui-state"><strong>${title}</strong><p>${copy}</p></article>`).join("");

  const scenarioValue = selected.scenarioValue || {};
  $("#uiBestScene").innerHTML = `<span>最能体现价值的场景</span><strong>${esc(scenarioValue.bestScene || "待验证")}</strong><p>${esc(scenarioValue.summary || "需要更多真实任务证据")}</p>`;
  $("#uiScenarioGrid").innerHTML = (scenarioValue.scenarios || []).map((item) => `<article class="ui-scenario-card"><div><span>适合度</span><b>${Number(item.fit || 0).toFixed(1)}<small>/5</small></b></div><h4>${esc(item.name)}</h4><p><strong>适合做：</strong>${esc(item.work)}</p><p><strong>为什么：</strong>${esc(item.why)}</p><small>界面证据：${esc(item.evidenceScreen)}<br>限制：${esc(item.limitation)}</small></article>`).join("") || '<p class="empty-mini">尚未形成场景价值判断。</p>';
  $("#uiScenarioComparison").innerHTML = `<h4>三个产品最适合的工作不同</h4><div>${productAudits.map((item) => `<article><span>${esc(item.competitorName)}</span><strong>${esc(item.scenarioValue?.bestScene || "待验证")}</strong><small>${esc(item.scenarioValue?.summary || "")}</small></article>`).join("")}</div>`;

  const usability = selected.usabilityScore || {};
  $("#uiUsabilityVerdict").innerHTML = `<div><span>上手便利度</span><strong>${Number(usability.total || 0).toFixed(1)}<small>/5</small></strong><em>证据置信度：${esc(usability.confidence?.level || "低")}</em></div><p>${esc(usability.verdict || "待验证")}</p><small>${esc(usability.scale || "5 分代表更容易上手、使用成本更低")}；${esc(usability.confidence?.note || "")}</small>`;
  $("#uiUsabilityDimensions").innerHTML = (usability.dimensions || []).map((item) => `<article><header><strong>${esc(item.label)}</strong><b>${Number(item.score || 0).toFixed(1)}</b></header><div class="ui-score-track"><i style="width:${Math.max(0, Math.min(100, Number(item.score || 0) * 20))}%"></i></div><p>${esc(item.reason)}</p><small>证据：${esc(item.evidenceScreen)}</small></article>`).join("") || '<p class="empty-mini">尚未形成上手成本评分。</p>';
  const usabilityProducts = productAudits.filter((item) => item.usabilityScore?.dimensions?.length);
  const usabilityLabels = usabilityProducts[0]?.usabilityScore?.dimensions?.map((item) => item.label) || [];
  $("#uiUsabilityComparison").innerHTML = usabilityProducts.length ? `<table class="data-table"><thead><tr><th>使用环节</th>${usabilityProducts.map((item) => `<th>${esc(item.competitorName)}</th>`).join("")}</tr></thead><tbody><tr><th>综合分</th>${usabilityProducts.map((item) => `<td><strong>${Number(item.usabilityScore.total || 0).toFixed(1)}/5</strong><br><small>${esc(item.usabilityScore.confidence?.level || "低")}置信度</small></td>`).join("")}</tr>${usabilityLabels.map((label, index) => `<tr><th>${esc(label)}</th>${usabilityProducts.map((item) => { const dimension = item.usabilityScore.dimensions[index] || {}; return `<td><strong>${Number(dimension.score || 0).toFixed(1)}</strong><br><small>${esc(dimension.reason || "待验证")}</small></td>`; }).join("")}</tr>`).join("")}</tbody></table>` : '<p class="empty-mini">尚未形成上手成本横向对比。</p>';
  renderBakeoffTables();

  const swimlanes = (selected.swimlanes || px.swimlanes || []).slice(0, 6);
  const lanes = [["用户", "user"], ["前端", "frontend"], ["Agent", "agent"], ["运营", "operations"], ["数据", "data"]];
  $("#uiSwimlane").innerHTML = swimlanes.length ? `<table><thead><tr><th>泳道 / 阶段</th>${swimlanes.map((item) => `<th>${esc(item.stage)}</th>`).join("")}</tr></thead><tbody>${lanes.map(([label, key]) => `<tr><th>${label}</th>${swimlanes.map((item) => `<td>${esc(item[key])}</td>`).join("")}</tr>`).join("")}</tbody></table>` : '<p class="empty-mini">尚未形成五方泳道。</p>';

  const tracking = (selected.trackingPlan || px.trackingPlan || []).slice(0, 8);
  $("#uiTrackingGrid").innerHTML = tracking.map((item, index) => `<article class="ui-tracking-card"><code>${String(index + 1).padStart(2, "0")} · ${esc(item.event)}</code><h4>${esc(item.metric)}</h4><p>${esc(item.trigger)}</p><small><b>产品决策：</b>${esc(item.decision)}<br><b>属性：</b>${esc(item.properties?.join(" · ") || "待定义")}</small></article>`).join("") || '<p class="empty-mini">尚未形成埋点方案。</p>';

  const model = selected.dataModel || px.dataModel || {};
  $("#uiDataPrinciples").innerHTML = (model.principles || []).slice(0, 4).map((item) => `<div class="ui-principle">${esc(item)}</div>`).join("");
  $("#uiEntityGrid").innerHTML = (model.entities || []).slice(0, 9).map((item) => `<article class="ui-entity"><code>${esc(item.name)}</code><h4>${esc(item.purpose)}</h4><p><b>字段：</b>${esc(item.keyFields?.join(" · ") || "待定义")}</p><p><b>关系：</b>${esc(item.relations?.join("；") || "待定义")}</p><small>${esc(item.retention)}</small></article>`).join("") || '<p class="empty-mini">尚未推导数据库实体。</p>';

  const backend = selected.backendDelivery || px.backendDelivery || {};
  $("#uiBackendSummary").innerHTML = `<p>${esc(backend.summary || "待从界面反推最小交付口径。")}</p>
    <div class="ui-backend-lists"><div><strong>用户故事</strong>${listHtml(backend.userStories, "待定义")}</div><div><strong>权限</strong>${listHtml(backend.permissions, "待定义")}</div><div><strong>验收</strong>${listHtml(backend.acceptance, "待定义")}</div></div>`;
  $("#uiApiGrid").innerHTML = (backend.apis || []).map((item) => `<article class="ui-api-card"><code>${esc(item.method)} ${esc(item.path)}</code><h4>${esc(item.purpose)}</h4><p>${esc(item.payload)}</p></article>`).join("") || '<p class="empty-mini">尚未倒推 API。</p>';
  $("#uiJobGrid").innerHTML = (backend.jobs || []).map((item) => `<article class="ui-job-card"><strong>${esc(item.name)}</strong><p>触发：${esc(item.trigger)}</p><small>写入：${esc(item.writes)}</small></article>`).join("") || '<p class="empty-mini">尚未倒推异步任务。</p>';

  const comparison = px.comparison || {};
  const products = [...new Set((comparison.cells || []).map((item) => item.product))];
  const dimensions = comparison.dimensions?.length ? comparison.dimensions : [...new Set((comparison.cells || []).map((item) => item.dimension))];
  const cellMap = new Map((comparison.cells || []).map((item) => [`${item.dimension}::${item.product}`, item]));
  $("#uiComparisonTable").innerHTML = products.length
    ? `<table class="data-table"><thead><tr><th>用户要做的事</th>${products.map((name) => `<th>${esc(name)}</th>`).join("")}</tr></thead><tbody>${dimensions.map((dimension) => `<tr><th>${esc(dimension)}</th>${products.map((name) => { const cell = cellMap.get(`${dimension}::${name}`) || {}; return `<td><strong>${esc(cell.focus || "待验证")}</strong><br><small>${esc(cell.note || "")}</small></td>`; }).join("")}</tr>`).join("")}</tbody></table>`
    : '<p class="empty-mini">尚未形成横向对比。重新调研后会比较从哪里开始、怎样操作、卡住后怎么办和最后怎样拿到结果。</p>';
  $("#uiFocusCards").innerHTML = productAudits.map((item) => `<article class="ui-focus-card"><span>${esc(item.role || "竞品")}</span><h4>${esc(item.competitorName)}</h4><p>${esc(item.designFocus || "侧重点待验证")}</p><small>优点：${esc(item.strengths?.join("、") || "待验证")} ｜ 短板：${esc(item.weaknesses?.join("、") || "待验证")}</small></article>`).join("");

  const fromUi = px.businessFromUi || {};
  const scenarios = (a.userNeeds?.scenarios || []).slice(0, 3).map((item) => item.name).join("；") || "待验证";
  const summary = [
    ["需求", (fromUi.demand || []).join("；") || (a.userNeeds?.painPoints || []).slice(0, 3).join("；") || "待验证"],
    ["核心场景", scenarios],
    ["怎样收费", (fromUi.monetizationSurfaces || []).join("；") || a.economics?.model || "待从额度、席位、升级入口验证"],
    ["开发与运行成本", [...(a.opportunities || []).filter((item) => Number(item.effort) >= 7).slice(0, 2).map((item) => `${item.title}（投入 ${item.effort}/10）`), ...(fromUi.costDrivers || []).slice(0, 2)].join("；") || "待估算"],
    ["运营闭环", (fromUi.operatingLoops || []).join("；") || `${a.economics?.retention || "待验证"}`],
    ["发展前景", fromUi.outlook || "个人工具 → 团队 Agent → 企业平台；数据飞轮与技能生态形成壁垒"],
  ];
  $("#uiBusinessSummary").innerHTML = summary.map(([title, copy]) => `<article class="ui-summary-card"><strong>${esc(title)}</strong><p>${esc(copy)}</p></article>`).join("");
}

async function captureUiEvidence() {
  if (!state.analysis) return toast("请先载入或完成一个分析项目", true);
  loading(true, "正在检索实际使用界面", "先打开官方文档子页，再检索知乎专栏等实操文中的功能场景与交叉用法；登录弹层会先关掉再取图。");
  try {
    const payload = await api("/api/ui-evidence/capture", { method: "POST", body: JSON.stringify({ analysis: state.analysis }) });
    setAnalysis(payload.analysis);
    const result = payload.visualResearch || {};
    toast(result.status === "failed" ? result.message : `界面证据已更新：${result.message}`, result.status === "failed");
  } catch (error) { toast(`截图抓取失败：${error.message}`, true); }
  finally { loading(false); }
}

function renderOpportunityMap() {
  const opportunities = state.analysis?.opportunities || [];
  const color = { Now: "#ff6b35", Next: "#2e8b77", Later: "#4d7eaa" };
  const bubbles = opportunities.map((item, index) => {
    const x = 8 + score(item.effort) * 8.4;
    const y = 8 + score(item.impact) * 8.4;
    const size = 42 + score(item.confidence) * 5;
    return `<div class="bubble" title="${esc(item.title)}｜影响 ${score(item.impact)}｜投入 ${score(item.effort)}｜信心 ${score(item.confidence)}" style="left:${x}%;bottom:${y}%;width:${size}px;height:${size}px;background:${color[item.horizon] || color.Next}"><span>${index + 1}</span></div>`;
  }).join("");
  $("#opportunityMap").innerHTML = `<span class="axis-label axis-x-left">投入低</span><span class="axis-label axis-x-right">投入高</span><span class="axis-label axis-y-top">影响高</span><span class="axis-label axis-y-bottom">影响低</span>${bubbles}`;
}

function renderRoadmap() {
  const a = state.analysis;
  $("#roadmapEmpty").classList.toggle("hidden", Boolean(a));
  $("#roadmapContent").classList.toggle("hidden", !a);
  if (!a) return;
  renderOpportunityMap();
  $("#opportunityList").innerHTML = (a.opportunities || []).map((item, index) => `<article class="opp-item ${String(item.horizon || "").toLowerCase()}">
    <div class="opp-item-head"><strong>${index + 1}. ${esc(item.title)}</strong><b>${esc(item.horizon || "Next")}</b></div>
    <p class="opp-rationale">${esc(item.rationale || "待补充")}</p><div class="opp-scores"><span>影响 <b>${score(item.impact)}</b></span><span>信心 <b>${score(item.confidence)}</b></span><span>投入 <b>${score(item.effort)}</b></span></div>
    <dl class="opp-details"><dt>用户/业务价值</dt><dd>${esc(item.value)}</dd><dt>关键风险</dt><dd>${esc(item.risk)}</dd><dt>指标</dt><dd>${esc(item.metric)}</dd><dt>负责人</dt><dd>${esc(item.owner)}</dd><dt>最小实验</dt><dd>${esc(item.experiment)}</dd><dt>成功标准</dt><dd>${esc(item.successCriteria)}</dd><dt>下一步</dt><dd>${esc(item.nextStep)}</dd></dl>
    <p>资源：${esc(item.resources?.join("、") || "待定义")} · 依赖：${esc(item.dependencies?.join("、") || "待定义")}</p><p>证据：${esc(item.evidenceIds?.join("、") || "无（信心上限 5）")}</p>
  </article>`).join("") || "<p>暂无机会项。</p>";
  $("#roadmapColumns").innerHTML = [
    ["NOW · 0–8 周", a.roadmap?.now], ["NEXT · 2–6 月", a.roadmap?.next], ["LATER · 6 月+", a.roadmap?.later],
  ].map(([title, items]) => `<div class="roadmap-column"><h3>${title}</h3><ol>${(items || ["待补充"]).map((item) => `<li>${esc(item)}</li>`).join("")}</ol></div>`).join("");
}

function renderAll() {
  renderDashboard();
  renderDeepDive();
  renderUiAnalysis();
  renderEvidence();
  renderRoadmap();
  const disabled = !state.analysis;
  ["#exportJsonBtn", "#openExport"].forEach((selector) => { $(selector).disabled = disabled; });
}

function persist() {
  if (state.analysis) localStorage.setItem("ai-ca-analysis", JSON.stringify(state.analysis));
}

function setAnalysis(analysis) {
  if (!analysis) {
    state.analysis = analysis;
  } else {
    const compiled = compileUiAuditFromScreens(analysis);
    compiled.bakeoff = compileBakeoff(compiled);
    state.analysis = compiled;
  }
  state.uiCompetitorIndex = 0;
  persist();
  renderAll();
}

function hydrateBrief(analysis) {
  if (!analysis) return;
  $("#briefTitle").value = analysis.meta?.title || "AI 产品竞品分析";
  $("#briefProduct").value = analysis.meta?.product || "";
  $("#briefAudience").value = analysis.meta?.audience || "产品与业务负责人";
  $("#briefObjective").value = analysis.meta?.objective || "";
  $("#briefDecision").value = analysis.meta?.decisionQuestion || "";
  state.competitors = (analysis.competitors || []).map((item) => ({ name: item.name || "", url: item.url || "", role: item.role || "直接竞品" }));
  if (!state.competitors.length) state.competitors = [{ name: analysis.meta?.product || "", url: "", role: "本品" }];
  renderCompetitorInputs();
}

function renderProjectList() {
  const query = $("#projectSearch").value.trim().toLowerCase();
  const projects = state.projects.filter((item) => [item.product, item.title, item.folderName, item.fileName].some((value) => String(value || "").toLowerCase().includes(query)));
  $("#projectList").innerHTML = projects.map((item) => {
    const status = item.researchStatus === "completed" ? "联网调研完成" : item.researchStatus === "partial" ? "部分完成" : "待继续调研";
    const modified = item.modifiedAt ? new Date(item.modifiedAt).toLocaleString("zh-CN", { hour12: false }) : "时间未知";
    return `<button class="project-item" data-project-id="${esc(item.id)}"><div><h3>${esc(item.product)}</h3><p>${esc(item.title)} · ${esc(item.folderName)}</p><div class="project-meta"><span>${esc(status)}</span><span>${item.competitors} 个对象</span><span>${item.evidence} 条证据</span><span>${esc(modified)}</span></div></div><span class="project-load">载入并修改 →</span></button>`;
  }).join("") || '<p class="project-empty">没有找到历史项目。保存一次项目 JSON 后会自动出现在这里。</p>';
  $$('[data-project-id]').forEach((button) => button.addEventListener("click", () => loadProject(button.dataset.projectId)));
}

async function loadProjects() {
  $("#projectList").innerHTML = '<p class="project-empty">正在读取历史项目…</p>';
  try {
    const payload = await api("/api/projects");
    state.projects = payload.projects || [];
    renderProjectList();
  } catch (error) {
    $("#projectList").innerHTML = `<p class="project-empty">${esc(error.message)}</p>`;
  }
}

async function loadProject(id) {
  loading(true, "正在载入历史项目", "正在恢复分析结果、竞品清单与任务设置。");
  try {
    const payload = await api(`/api/projects/load?id=${encodeURIComponent(id)}`);
    setAnalysis(payload.analysis);
    hydrateBrief(payload.analysis);
    $("#projectsDialog").close();
    setView("dashboard");
    toast(`已载入：${payload.analysis.meta?.product || "历史项目"}，可继续修改或重新调研`);
  } catch (error) { toast(error.message, true); }
  finally { loading(false); }
}

async function runAnalysis() {
  if (analyzing) return toast("当前调研还在进行，请不要重复点击");
  try {
    const brief = collectBrief();
    if (!state.health?.keyConfigured) {
      $("#settingsDialog").showModal();
      return toast("请先配置 DeepSeek API Key", true);
    }
    analyzing = true;
    loading(true, brief.autoResearch ? "正在联网调研与分析" : "正在进行七层分析", brief.autoResearch
      ? "正在搜索公开资料。搜完后会写七层分析；已有工作台截图的产品不再打开官网。请不要重复点击「开始调研」。"
      : "DeepSeek 正在组织需求、行业、AI 能力、数据、商业与决策证据。通常需要 30–120 秒。");
    const payload = await api("/api/analyze", { method: "POST", body: JSON.stringify(brief) });
    setAnalysis(payload.analysis);
    setView("dashboard");
    toast(`分析完成 · ${payload.model}${payload.research ? ` · ${payload.research.searchCalls} 次联网搜索` : ""}${payload.usage?.total_tokens ? ` · ${payload.usage.total_tokens} tokens` : ""}`);
  } catch (error) {
    toast(error.message, true);
    if (/API Key|鉴权|401/.test(error.message)) $("#settingsDialog").showModal();
  } finally {
    analyzing = false;
    loading(false);
  }
}

async function loadDemo() {
  try {
    loading(true, "正在载入演示", "演示内容为虚构数据，用于体验看板、标注界面、后端口径与导出功能。");
    const payload = await api("/api/demo");
    setAnalysis(payload.analysis);
    setView("dashboard");
    toast("已载入演示数据；其中公司与数据均为虚构");
  } catch (error) { toast(error.message, true); }
  finally { loading(false); }
}

async function exportJson() {
  if (!state.analysis) return toast("请先完成分析", true);
  loading(true, "正在保存项目 JSON", "正在按调研主题和日期整理报告目录。");
  try {
    const payload = await api("/api/export/json", {
      method: "POST",
      body: JSON.stringify({ analysis: state.analysis }),
    });
    $("#exportDialog").close();
    toast(`项目 JSON 已保存：${payload.savedPath}`);
  } catch (error) { toast(error.message, true); }
  finally { loading(false); }
}

function visualDataUrl() {
  const canvas = document.createElement("canvas");
  canvas.width = 1240;
  canvas.height = 660;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f5f3ec";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#11231f";
  ctx.font = "700 36px Microsoft YaHei";
  ctx.fillText("竞争格局快照", 56, 60);
  ctx.font = "16px Microsoft YaHei";
  ctx.fillStyle = "#66766f";
  ctx.fillText("九维加权总分（0–10）", 56, 90);
  const competitors = state.analysis?.competitors?.slice(0, 6) || [];
  competitors.forEach((item, index) => {
    const y = 145 + index * 72;
    const total = weightedScore(item);
    ctx.fillStyle = "#11231f";
    ctx.font = "700 18px Microsoft YaHei";
    ctx.fillText(String(item.name).slice(0, 18), 56, y + 20);
    ctx.fillStyle = "#e0e3dd";
    ctx.fillRect(300, y, 780, 24);
    ctx.fillStyle = colorForScore(total);
    ctx.fillRect(300, y, 780 * total / 10, 24);
    ctx.fillStyle = "#11231f";
    ctx.font = "700 18px ui-monospace";
    ctx.fillText(total.toFixed(1), 1100, y + 20);
  });
  ctx.fillStyle = "#2e8b77";
  ctx.font = "700 15px Microsoft YaHei";
  ctx.fillText(`北极星：${state.analysis?.northStar?.metric || "待定义"}`, 56, 610);
  return canvas.toDataURL("image/png");
}

async function exportOffice(kind) {
  if (!state.analysis) return toast("请先完成分析", true);
  const label = kind === "pptx" ? "PPTX" : "Word 报告";
  loading(true, `正在生成 ${label}`, kind === "pptx" ? "正在创建可编辑图表和逐页演讲备注。" : "正在排版完整分析报告与证据登记。");
  try {
    const payload = await api(`/api/export/${kind}`, {
      method: "POST",
      body: JSON.stringify({ analysis: state.analysis, visualDataUrl: kind === "docx" ? visualDataUrl() : "" }),
    });
    $("#exportDialog").close();
    toast(`${label} 已保存：${payload.savedPath}`);
  } catch (error) { toast(error.message, true); }
  finally { loading(false); }
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed?.meta || !Array.isArray(parsed?.competitors)) throw new Error("不是有效的竞品分析项目 JSON");
      const payload = await api("/api/normalize", { method: "POST", body: JSON.stringify({ analysis: parsed }) });
      setAnalysis(payload.analysis);
      hydrateBrief(payload.analysis);
      setView("dashboard");
      toast("项目已导入");
    } catch (error) { toast(error.message, true); }
  };
  reader.readAsText(file, "utf-8");
}

function bindEvents() {
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $$('[data-go]').forEach((button) => button.addEventListener("click", () => setView(button.dataset.go)));
  $("#addCompetitor").addEventListener("click", () => { state.competitors.push({ name: "", url: "", role: "直接竞品" }); renderCompetitorInputs(); });
  $("#briefProduct").addEventListener("input", (event) => {
    if (!state.competitors[0].name) {
      const input = $('.competitor-row[data-index="0"] [data-field="name"]');
      if (input) input.placeholder = event.target.value || "目标产品名称";
    }
  });
  $("#analyzeBtn").addEventListener("click", runAnalysis);
  $("#loadDemo").addEventListener("click", loadDemo);
  $("#openSettings").addEventListener("click", () => $("#settingsDialog").showModal());
  $$('[data-close-settings]').forEach((button) => button.addEventListener("click", () => $("#settingsDialog").close()));
  $("#settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/config", { method: "POST", body: JSON.stringify({
        apiKey: $("#apiKey").value.trim(), baseUrl: $("#baseUrl").value.trim(), model: $("#modelName").value.trim(),
      }) });
      $("#apiKey").value = "";
      const result = await api("/api/test-model", { method: "POST", body: "{}" });
      await refreshHealth();
      $("#settingsDialog").close();
      toast(`DeepSeek 已真实连通：${result.model}`);
    } catch (error) {
      await refreshHealth();
      toast(`设置已保存，但连接测试失败：${error.message}`, true);
    }
  });
  $("#openExport").addEventListener("click", () => $("#exportDialog").showModal());
  $("#openProjects").addEventListener("click", async () => { $("#projectsDialog").showModal(); await loadProjects(); });
  $("#closeProjects").addEventListener("click", () => $("#projectsDialog").close());
  $("#refreshProjects").addEventListener("click", loadProjects);
  $("#projectSearch").addEventListener("input", renderProjectList);
  $("#closeExport").addEventListener("click", () => $("#exportDialog").close());
  $("#exportPptx").addEventListener("click", () => exportOffice("pptx"));
  $("#exportDocx").addEventListener("click", () => exportOffice("docx"));
  $("#exportJsonBtn").addEventListener("click", exportJson);
  $("#exportJsonFromDialog").addEventListener("click", exportJson);
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", (event) => { if (event.target.files[0]) importJson(event.target.files[0]); event.target.value = ""; });
}

async function init() {
  renderCompetitorInputs();
  bindEvents();
  const saved = localStorage.getItem("ai-ca-analysis");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      const payload = await api("/api/normalize", { method: "POST", body: JSON.stringify({ analysis: parsed }) });
      setAnalysis(payload.analysis);
      hydrateBrief(payload.analysis);
    } catch { localStorage.removeItem("ai-ca-analysis"); }
  }
  renderAll();
  await refreshHealth();
}

init();
