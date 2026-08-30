import { buildAnalysisPrompt, buildEvidenceHarvestPrompt, namesLikelySame } from "./analysis.mjs";
import { harvestSearchBudget } from "./source-harvest.mjs";

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

export function responsesEndpoint(baseUrl) {
  return `${String(baseUrl || "").replace(/\/$/, "")}/responses`;
}

export function chatEndpoint(baseUrl) {
  return `${String(baseUrl || "").replace(/\/$/, "")}/chat/completions`;
}

export function buildResearchRequest(brief) {
  const budget = harvestSearchBudget(brief?.competitors?.length || 1);
  return {
    model: "deepseek-v4-flash",
    instructions: [
      "你是严谨的 AI 产品竞品调研检索员。",
      "先用 web_search 核对公开资料，再输出精简 JSON。",
      `全部产品合计最多 ${budget} 次搜索（含打开页面）。每个产品先定位 docs/help/learn/courses 主机，再用 site:该主机打开侧栏、hash 内页或课程目录。`,
      "联盟追踪落地页去掉 cj/utm 后再跟内页。禁止停在官网首页。搜完必须立即输出 JSON，不要写七层分析。",
    ].join("\n"),
    input: buildEvidenceHarvestPrompt({ ...brief, autoResearch: true }),
    tools: [{ type: "web_search" }],
    tool_choice: "auto",
    reasoning: { effort: "low" },
    text: { format: { type: "json_object" } },
    max_output_tokens: 8000,
    stream: true,
  };
}

export function harvestSearchItems(envelope) {
  return (Array.isArray(envelope?.output) ? envelope.output : [])
    .filter((item) => item?.type === "web_search_call")
    .slice(-24);
}

export function extractSearchNotes(envelope) {
  const queries = [];
  const urls = [];
  for (const item of harvestSearchItems(envelope)) {
    const action = item?.action || {};
    if (action.query) queries.push(String(action.query).trim());
    for (const value of [action.url, action.source, ...(Array.isArray(action.urls) ? action.urls : [])]) {
      const url = String(value || "").trim();
      if (/^https?:\/\//iu.test(url)) urls.push(url);
    }
  }
  return {
    queries: [...new Set(queries.filter(Boolean))],
    urls: [...new Set(urls)],
  };
}

export function buildHarvestCompileRequest(brief, harvestEnvelope) {
  const searches = harvestSearchItems(harvestEnvelope);
  const notes = extractSearchNotes(harvestEnvelope);
  return {
    model: "deepseek-v4-flash",
    instructions: "停止搜索。根据已完成的 web_search 结果只输出精简证据 JSON，禁止再调用任何工具。",
    input: [
      { role: "user", content: buildEvidenceHarvestPrompt({ ...brief, autoResearch: true }) },
      ...searches,
      {
        role: "user",
        content: [
          "根据上面已恢复的搜索结果，只输出一个 JSON 对象。",
          "搜不到的写入 gaps，禁止编造 URL、价格或市场份额。",
          notes.queries.length ? `已执行查询：${notes.queries.slice(0, 12).join("；")}` : "",
          notes.urls.length ? `已出现 URL：${notes.urls.slice(0, 16).join(" ")}` : "",
        ].filter(Boolean).join("\n"),
      },
    ],
    tool_choice: "none",
    reasoning: { effort: "low" },
    text: { format: { type: "json_object" } },
    max_output_tokens: 8000,
    stream: true,
  };
}

export function buildUiDiscoveryRequest(analysis) {
  const products = (analysis?.competitors || []).slice(0, 4).map((item) => item.name).filter(Boolean).join("；");
  return {
    model: "deepseek-v4-flash",
    instructions: [
      "找能看到真实软件界面或功能场景的 URL。",
      "优先官方文档站、学习中心和开发者门户。形态参考 https://www.workbuddy.cn/docs/workbuddy/Overview、https://aecore.glodon.com/docs/aecore/guide_1_preview.html#%E6%88%90%E4%B8%BA%E5%BC%80%E5%8F%91%E8%80%85、https://learnacc.autodesk.com/page/courses。打开侧栏子页、hash 章节或 courses，不要停在官网首页或带 cjdata 的落地页。",
      "文档不够时，办公类检索优设/知乎/少数派（https://www.uisdc.com/workbuddy-complete-guide、https://zhuanlan.zhihu.com/p/2072617646596608260）和 B 站；AEC 类检索 Autodesk University、help.autodesk.com、boards.autodesk.com 去参后的内页。",
      "最多 6 次搜索。不要写分析报告。",
    ].join("\n"),
    input: `为以下产品各找 1-2 个来源 URL（文档子页如创建任务/结果查看，或知乎/少数派实操文中的功能场景）：${products}\n只输出 JSON：{"uiEvidence":[{"productName":"","screen":"","usageStage":"进入/发起/执行/交付","sourceType":"official_tutorial/secondary_walkthrough","sourceUrl":"","claim":"该文证明的功能场景"}],"gaps":[]}`,
    tools: [{ type: "web_search" }],
    tool_choice: "auto",
    reasoning: { effort: "low" },
    text: { format: { type: "json_object" } },
    max_output_tokens: 4000,
    stream: true,
  };
}

export function buildOfflineRequest(brief, model) {
  return {
    model,
    messages: [
      { role: "system", content: "你是严谨的 AI 产品竞品分析 Agent。只输出一个可 JSON.parse 的对象，不要 Markdown。字符串内双引号必须写成 \\\"，数组元素之间必须有逗号，禁止尾逗号。" },
      { role: "user", content: buildAnalysisPrompt({ ...brief, autoResearch: false }) },
    ],
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
    max_tokens: 20000,
    stream: false,
  };
}

export function buildJsonRepairRequest(model, brokenText) {
  return {
    model,
    messages: [
      { role: "system", content: "你只输出修复后的完整 JSON 对象。不要 Markdown、不要注释、不要解释。" },
      { role: "user", content: `下面的 JSON 无法被 JSON.parse 解析。请修复语法（补逗号、转义字符串内双引号、补全括号），尽量保留原有字段和内容。\n\n${String(brokenText || "").slice(0, 70000)}` },
    ],
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
    max_tokens: 20000,
    stream: false,
  };
}

export function extractChatContent(envelope) {
  const message = envelope?.choices?.[0]?.message;
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content.map((part) => part?.text || part?.content || "").join("\n").trim();
  }
  if (message?.content && typeof message.content === "object") return JSON.stringify(message.content);
  return "";
}

export function stripJsonFences(text) {
  return String(text || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function jsonErrorPosition(error) {
  const match = String(error?.message || "").match(/position\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function closeOpenStructures(text) {
  let inString = false;
  let escape = false;
  const stack = [];
  for (const char of text) {
    if (inString) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if ((char === "}" || char === "]") && stack[stack.length - 1] === char) stack.pop();
  }
  let repaired = text.replace(/[\s,]+$/u, "");
  if (inString) repaired += "\"";
  repaired = repaired.replace(/,\s*$/u, "");
  while (stack.length) repaired += stack.pop();
  return repaired;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function coerceJson(text) {
  if (text && typeof text === "object") return text;
  const stripped = stripJsonFences(text);
  if (!stripped) return null;
  const start = stripped.indexOf("{");
  const objectText = start >= 0 ? stripped.slice(start) : stripped;
  const end = objectText.lastIndexOf("}");
  const candidates = [stripped, objectText];
  if (end > 0) candidates.push(objectText.slice(0, end + 1));
  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate) || tryParseJson(candidate.replace(/,(\s*[}\]])/gu, "$1"));
    if (parsed) return parsed;
  }
  let working = objectText;
  for (let round = 0; round < 6; round += 1) {
    try {
      return JSON.parse(working);
    } catch (error) {
      const closed = tryParseJson(closeOpenStructures(working));
      if (closed) return closed;
      const position = jsonErrorPosition(error);
      if (position == null || position < 8) break;
      const cut = Math.min(position, working.length);
      const next = closeOpenStructures(working.slice(0, cut).replace(/[\s,:]+$/u, ""));
      if (!next || next === working || next.length < 8) break;
      working = next;
    }
  }
  return tryParseJson(closeOpenStructures(objectText));
}

export function buildConnectionTestRequest(model) {
  return {
    model,
    messages: [
      { role: "system", content: "你是 API 连通性检测助手。" },
      { role: "user", content: "只回复 OK" },
    ],
    thinking: { type: "disabled" },
    max_tokens: 16,
    stream: false,
  };
}

export function extractResponseText(envelope) {
  if (typeof envelope?.output_text === "string" && envelope.output_text.trim()) return envelope.output_text;
  const parts = [];
  for (const item of Array.isArray(envelope?.output) ? envelope.output : []) {
    if (typeof item?.text === "string") parts.push(item.text);
    if (item?.type !== "message" && item?.type !== "output_text") continue;
    for (const content of Array.isArray(item.content) ? item.content : []) {
      if (typeof content?.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function sseTextDelta(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.delta === "string") return payload.delta;
  if (typeof payload?.text === "string") return payload.text;
  return "";
}

export function extractWebSearchActions(envelope) {
  return (Array.isArray(envelope?.output) ? envelope.output : [])
    .filter((item) => item?.type === "web_search_call")
    .map((item) => ({
      id: String(item.id || ""),
      status: String(item.status || "completed"),
      action: item.action || null,
    }));
}

function asTextList(value, limit = 12) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

export function normalizeHarvest(raw = {}) {
  const competitors = (Array.isArray(raw.competitors) ? raw.competitors : [])
    .map((item) => ({
      name: String(item?.name || "").trim(),
      url: String(item?.url || "").trim(),
      role: String(item?.role || "直接竞品").trim() || "直接竞品",
      positioning: String(item?.positioning || "").trim(),
      pricing: String(item?.pricing || "").trim(),
      notes: String(item?.notes || "").trim(),
    }))
    .filter((item) => item.name)
    .slice(0, 8);
  const evidence = (Array.isArray(raw.evidence) ? raw.evidence : [])
    .map((item, index) => ({
      id: String(item?.id || `E${String(index + 1).padStart(2, "0")}`),
      title: String(item?.title || "").trim(),
      url: String(item?.url || "").trim(),
      date: String(item?.date || "").trim(),
      type: String(item?.type || "公开资料").trim(),
      claim: String(item?.claim || "").trim(),
      confidence: ["高", "中", "低"].includes(item?.confidence) ? item.confidence : "中",
    }))
    .filter((item) => item.title || item.url || item.claim)
    .slice(0, 24);
  const uiEvidence = (Array.isArray(raw.uiEvidence) ? raw.uiEvidence : [])
    .map((item) => ({
      productName: String(item?.productName || "").trim(),
      screen: String(item?.screen || "").trim(),
      usageStage: String(item?.usageStage || "待验证").trim(),
      sourceType: /(?:uisdc\.com|zhihu|zhimg|sspai|juejin|csdn|jianshu|medium\.com|xiaohongshu|pconline)/iu.test(String(item?.sourceUrl || ""))
        ? "secondary_walkthrough"
        : (["official_tutorial", "secondary_walkthrough", "video_walkthrough"].includes(item?.sourceType) ? item.sourceType : "secondary_walkthrough"),
      sourceUrl: String(item?.sourceUrl || "").trim(),
      imageUrl: String(item?.imageUrl || "").trim(),
      videoTimestamp: String(item?.videoTimestamp || "").trim(),
      videoSeconds: Math.max(0, Number(item?.videoSeconds) || 0),
      claim: String(item?.claim || "").trim(),
    }))
    .filter((item) => item.productName && item.sourceUrl)
    .slice(0, 40);
  return {
    queries: asTextList(raw.queries),
    summary: String(raw.summary || "").trim(),
    gaps: asTextList(raw.gaps),
    competitors,
    evidence,
    uiEvidence,
  };
}

export function mergeBriefWithHarvest(brief, harvest) {
  const seen = new Map();
  const add = (item) => {
    const name = String(item?.name || "").trim();
    if (!name) return;
    const existingKey = [...seen.keys()].find((key) => key === name.toLowerCase() || namesLikelySame(seen.get(key).name, name));
    const key = existingKey || name.toLowerCase();
    const prev = seen.get(key) || {};
    seen.set(key, {
      name: prev.name || name,
      url: String(item.url || prev.url || "").trim(),
      role: String(prev.role || item.role || "直接竞品").trim() || "直接竞品",
      positioning: String(item.positioning || prev.positioning || "").trim(),
      pricing: String(item.pricing || prev.pricing || "").trim(),
    });
  };
  for (const item of brief?.competitors || []) add(item);
  const userCount = (brief?.competitors || []).filter((item) => String(item?.name || "").trim()).length;
  for (const item of harvest?.competitors || []) {
    const exists = [...seen.values()].some((entry) => namesLikelySame(entry.name, item.name));
    if (exists || userCount < 4) add(item);
  }
  const harvestNotes = JSON.stringify({
    source: "deepseek_web_search",
    summary: harvest?.summary || "",
    queries: harvest?.queries || [],
    gaps: harvest?.gaps || [],
    competitors: harvest?.competitors || [],
    evidence: harvest?.evidence || [],
    uiEvidence: harvest?.uiEvidence || [],
  }, null, 2);
  return {
    ...brief,
    autoResearch: false,
    competitors: [...seen.values()],
    evidenceNotes: [brief?.evidenceNotes || "", "联网检索材料（必须引用其中 URL，禁止编造）：", harvestNotes]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 60000),
    evidenceInstruction: "只使用用户材料与下方联网检索材料；不得编造 URL、价格或市场份额。",
  };
}

export function parseSseBlock(block) {
  let event = "message";
  const dataLines = [];
  for (const line of String(block || "").split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  const raw = dataLines.join("\n");
  let data = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }
  return { event, data };
}

function envelopeFromSseEvent(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.response && typeof payload.response === "object") return payload.response;
  if (Array.isArray(payload.output) || typeof payload.output_text === "string") return payload;
  return null;
}

export async function readDeepSeekEnvelope(response) {
  const type = response?.headers?.get?.("content-type") || "";
  if (!type.includes("event-stream")) {
    const raw = await response.text();
    if (!raw.trim()) throw new Error("DeepSeek 返回了空响应");
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("DeepSeek 返回内容不是有效 JSON");
    }
  }
  if (!response.body) throw new Error("DeepSeek 流式响应缺少正文");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let envelope = null;
  let failedMessage = "";
  let streamedText = "";
  const consume = (chunk) => {
    const parsed = parseSseBlock(chunk);
    if (!parsed) return;
    if (parsed.event === "response.failed") {
      failedMessage = parsed.data?.response?.error?.message
        || parsed.data?.error?.message
        || "DeepSeek 流式响应失败";
    }
    if (parsed.event === "response.output_text.delta" || parsed.event === "response.output_text.done") {
      streamedText += sseTextDelta(parsed.data);
    }
    if (parsed.event === "response.completed" || parsed.event === "response.incomplete") {
      envelope = envelopeFromSseEvent(parsed.data) || envelope;
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      if (buffer.trim()) consume(buffer);
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\r?\n\r?\n/);
    buffer = chunks.pop() || "";
    chunks.forEach(consume);
  }
  if (failedMessage) {
    const error = new Error(failedMessage);
    error.code = "DEEPSEEK_UPSTREAM_FAILED";
    throw error;
  }
  if (!envelope && streamedText.trim()) {
    envelope = { output_text: streamedText, output: [], status: "incomplete" };
  }
  if (!envelope) throw new Error("DeepSeek 流式响应未完成，没有收到最终结果");
  if (streamedText.trim() && !String(envelope.output_text || "").trim()) {
    envelope = { ...envelope, output_text: streamedText };
  }
  return envelope;
}

export function isTransientNetworkError(error) {
  return TRANSIENT_NETWORK_CODES.has(error?.cause?.code || error?.code);
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function fetchWithRetry(url, options, fetchImpl = fetch, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchImpl(url, options);
    } catch (error) {
      lastError = error;
      if (error?.name === "AbortError" || !isTransientNetworkError(error) || attempt === retries) throw error;
      await delay(500 * (attempt + 1));
    }
  }
  throw lastError;
}

export function friendlyNetworkError(error) {
  const code = error?.cause?.code || error?.code || "";
  if (code === "EACCES" || code === "EPERM") {
    return {
      code: "NETWORK_PERMISSION_DENIED",
      message: "联网请求被本机权限策略拦截。请使用 scripts/start.ps1 启动服务，或允许 Node.js 访问网络。",
    };
  }
  if (isTransientNetworkError(error)) {
    return {
      code: "DEEPSEEK_NETWORK_FAILED",
      message: "连接 DeepSeek 时发生临时网络错误，自动重试后仍未恢复。请检查代理、防火墙或稍后重试。",
    };
  }
  return {
    code: "DEEPSEEK_NETWORK_FAILED",
    message: `无法连接 DeepSeek${code ? `（${code}）` : ""}，请检查网络、代理和防火墙设置。`,
  };
}
