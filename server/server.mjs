import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { applyHarvestUiEvidence, DEMO_ANALYSIS, normalizeAnalysis, pinCompetitorsToBrief } from "./analysis.mjs";
import { compileUiAuditFromScreens } from "../public/ui-audit.js";
import {
  buildConnectionTestRequest,
  buildHarvestCompileRequest,
  buildJsonRepairRequest,
  buildOfflineRequest,
  buildResearchRequest,
  buildUiDiscoveryRequest,
  chatEndpoint,
  coerceJson,
  extractChatContent,
  extractResponseText,
  extractWebSearchActions,
  fetchWithRetry,
  friendlyNetworkError,
  mergeBriefWithHarvest,
  normalizeHarvest,
  readDeepSeekEnvelope,
  responsesEndpoint,
} from "./deepseek.mjs";
import { buildDocx, buildPptx } from "./office.mjs";
import { listReportProjects, readReportProject, saveReport } from "./report-store.mjs";
import { enrichVisualEvidence, knownAppUiFor } from "./visual-evidence.mjs";
import { applyLiveWebBakeoff } from "./web-bakeoff.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const REPORTS_ROOT = path.join(ROOT, "报告下载");
const UI_ASSETS_ROOT = path.join(PUBLIC, "generated", "ui");
const PORT = Number(process.env.PORT || 4173);
const HOST = "127.0.0.1";
const MAX_BODY = 12 * 1024 * 1024;

const runtimeConfig = {
  apiKey: process.env.DEEPSEEK_API_KEY || "",
  baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
};

const connectionState = {
  verified: false,
  checkedAt: null,
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

function fail(res, status, message, code = "REQUEST_FAILED") {
  json(res, status, { ok: false, error: { code, message } });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("请求内容超过 12MB 限制");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("请求不是有效 JSON");
  }
}

function validateBaseUrl(value) {
  const url = new URL(value);
  const localhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localhost)) {
    throw new Error("API 地址必须使用 HTTPS；仅 localhost 可使用 HTTP");
  }
  return url.toString().replace(/\/$/, "");
}

function extractJson(text) {
  const parsed = coerceJson(text);
  if (parsed && typeof parsed === "object") return parsed;
  const error = new Error("模型返回的 JSON 不完整或语法损坏。系统已尝试自动修复仍失败，请重试。");
  error.status = 502;
  error.code = "DEEPSEEK_JSON_INVALID";
  throw error;
}

function failDeepSeek(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function interpretUpstreamError(response, raw) {
  let detail = "";
  try {
    const parsed = JSON.parse(raw);
    detail = parsed?.error?.message || parsed?.message || "";
  } catch {
    detail = String(raw || "").slice(0, 240);
  }
  return failDeepSeek(
    [400, 401, 402, 429].includes(response.status) ? response.status : 502,
    response.status === 401 ? "DEEPSEEK_AUTH_FAILED" : "DEEPSEEK_UPSTREAM_FAILED",
    `DeepSeek 请求失败（${response.status}）${detail ? `：${detail}` : ""}`,
  );
}

function interpretCallError(error, timeoutMessage) {
  if (error.name === "AbortError") {
    return failDeepSeek(504, "DEEPSEEK_TIMEOUT", timeoutMessage);
  }
  if (error instanceof SyntaxError) {
    return failDeepSeek(502, "DEEPSEEK_JSON_INVALID", "模型返回的 JSON 语法损坏，已拦截原始解析错误。请重试一次。");
  }
  if (error instanceof TypeError || error?.cause?.code) {
    const detail = friendlyNetworkError(error);
    return failDeepSeek(502, detail.code, detail.message);
  }
  return error;
}

async function postDeepSeek(endpoint, requestBody, { signal, stream = false } = {}) {
  const response = await fetchWithRetry(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${runtimeConfig.apiKey}`,
      ...(stream ? { accept: "text/event-stream" } : {}),
    },
    signal,
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) {
    throw interpretUpstreamError(response, await response.text());
  }
  return readDeepSeekEnvelope(response);
}

async function withTimeout(timeoutMs, timeoutMessage, work) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await work(controller.signal);
  } catch (error) {
    throw interpretCallError(error, timeoutMessage);
  } finally {
    clearTimeout(timeout);
  }
}

async function parseModelJson(text, signal) {
  try {
    return extractJson(text);
  } catch (error) {
    if (error.code !== "DEEPSEEK_JSON_INVALID") throw error;
    const envelope = await postDeepSeek(
      chatEndpoint(runtimeConfig.baseUrl),
      buildJsonRepairRequest(runtimeConfig.model, text),
      { signal },
    );
    return extractJson(extractChatContent(envelope));
  }
}

function countUiSources(analysis) {
  return (analysis.productExperience?.competitorAudits || []).reduce((sum, group) => sum + (group.interfaceAudit || []).filter((item) => item.sourceUrl).length, 0);
}

async function ensureUiSources(analysis) {
  const catalogReady = (analysis.competitors || []).filter((item) => knownAppUiFor(item.name)).length >= 2;
  if (catalogReady || countUiSources(analysis) >= 2 || !runtimeConfig.apiKey) return analysis;
  try {
    const extra = await withTimeout(
      120000,
        "正在定向检索官方文档和知乎等实操文中的应用界面，但仍超过 2 分钟。",
      async (signal) => {
        const envelope = await postDeepSeek(responsesEndpoint(runtimeConfig.baseUrl), buildUiDiscoveryRequest(analysis), { signal, stream: true });
        const text = extractResponseText(envelope);
        console.warn(`[ui-discovery] status=${envelope?.status || "unknown"} chars=${text.length}`);
        if (!text.trim()) return null;
        return normalizeHarvest(await parseModelJson(text, signal));
      },
    );
    return extra ? applyHarvestUiEvidence(analysis, extra) : analysis;
  } catch (error) {
    console.warn(`[ui-discovery] ${error.message}`);
    return analysis;
  }
}

function stampResearch(analysis, harvest, searchActions) {
  const linkedEvidence = analysis.evidence.filter((item) => item.url).length;
  analysis.research = {
    ...analysis.research,
    mode: "web_search",
    status: linkedEvidence > 0 ? "completed" : "partial",
    searchedAt: new Date().toISOString(),
    searchCalls: searchActions.length,
    queries: harvest?.queries?.length ? harvest.queries : analysis.research?.queries,
    summary: harvest?.summary || analysis.research?.summary,
    gaps: harvest?.gaps?.length ? harvest.gaps : analysis.research?.gaps,
  };
  return analysis;
}

async function callDeepSeek(brief) {
  if (!runtimeConfig.apiKey) {
    throw failDeepSeek(401, "KEY_NOT_CONFIGURED", "尚未配置 DeepSeek API Key，请在模型设置中输入或设置环境变量");
  }
  const autoResearch = brief?.autoResearch !== false;
  if (!autoResearch) {
    const requestBody = buildOfflineRequest(brief, runtimeConfig.model);
    const envelope = await withTimeout(
      180000,
      "DeepSeek 分析超过 180 秒，已安全取消；当前项目未被覆盖。",
      (signal) => postDeepSeek(chatEndpoint(runtimeConfig.baseUrl), requestBody, { signal }),
    );
    const analysis = await applyLiveWebBakeoff(compileUiAuditFromScreens(await enrichVisualEvidence(pinCompetitorsToBrief(normalizeAnalysis(await withTimeout(
      180000,
      "DeepSeek 正在修复损坏的分析 JSON，但仍超过 3 分钟。当前项目未被覆盖，请重试。",
      (signal) => parseModelJson(extractChatContent(envelope), signal),
    )), brief), { assetsRoot: UI_ASSETS_ROOT })));
    return {
      analysis,
      usage: envelope?.usage || null,
      model: envelope?.model || requestBody.model,
      research: null,
    };
  }

  const harvestRequest = buildResearchRequest(brief);
  const harvestEnvelope = await withTimeout(
    240000,
    "DeepSeek 联网搜索超过 4 分钟仍未完成。模型设置里的连通测试只验证对话接口；搜索走的是另一条 Responses API。当前项目未被覆盖，请稍后重试，或暂时关闭「自动联网调研」。",
    (signal) => postDeepSeek(responsesEndpoint(runtimeConfig.baseUrl), harvestRequest, { signal, stream: true }),
  );
  let harvestText = extractResponseText(harvestEnvelope);
  const searchActions = extractWebSearchActions(harvestEnvelope);
  console.warn(`[harvest] status=${harvestEnvelope?.status || "unknown"} chars=${harvestText.length} searches=${searchActions.length}`);
  if (!harvestText.trim() && searchActions.length) {
    const compileRequest = buildHarvestCompileRequest(brief, harvestEnvelope);
    const compileEnvelope = await withTimeout(
      180000,
      "DeepSeek 已完成联网搜索，但整理证据清单超过 3 分钟。当前项目未被覆盖，请重试。",
      (signal) => postDeepSeek(responsesEndpoint(runtimeConfig.baseUrl), compileRequest, { signal, stream: true }),
    );
    harvestText = extractResponseText(compileEnvelope);
    console.warn(`[harvest-compile] status=${compileEnvelope?.status || "unknown"} chars=${harvestText.length}`);
  }
  if (!harvestText.trim()) {
    throw failDeepSeek(
      502,
      "DEEPSEEK_HARVEST_EMPTY",
      "联网搜索已结束，但模型没有写出证据清单。请重试一次；若仍失败，可关闭「自动联网调研」后用已填写的产品信息分析。",
    );
  }
  let harvest;
  try {
    harvest = normalizeHarvest(await withTimeout(
      180000,
      "DeepSeek 已完成联网搜索，但修复证据 JSON 超过 3 分钟。当前项目未被覆盖，请重试。",
      (signal) => parseModelJson(harvestText, signal),
    ));
  } catch {
    throw failDeepSeek(
      502,
      "DEEPSEEK_HARVEST_INVALID",
      "联网搜索已返回，但证据 JSON 不完整。请重试一次；若仍失败，可关闭「自动联网调研」后用已填写的产品信息分析。",
    );
  }
  const analysisRequest = buildOfflineRequest(mergeBriefWithHarvest(brief, harvest), runtimeConfig.model);
  console.warn("[analysis] writing seven-layer report");
  const analysisEnvelope = await withTimeout(
    180000,
    "DeepSeek 已完成联网搜索，但后续分析超过 3 分钟。当前项目未被覆盖，请重试。",
    (signal) => postDeepSeek(chatEndpoint(runtimeConfig.baseUrl), analysisRequest, { signal }),
  );
  const parsed = await withTimeout(
    180000,
    "DeepSeek 已完成联网搜索和分析，但 JSON 修复超过 3 分钟。当前项目未被覆盖，请重试。",
    (signal) => parseModelJson(extractChatContent(analysisEnvelope), signal),
  );
  if ((!Array.isArray(parsed.evidence) || !parsed.evidence.length) && harvest.evidence.length) {
    parsed.evidence = harvest.evidence;
  }
  console.warn("[analysis] report parsed, attaching UI evidence");
  const analysis = await applyLiveWebBakeoff(compileUiAuditFromScreens(await enrichVisualEvidence(
    await ensureUiSources(pinCompetitorsToBrief(normalizeAnalysis(applyHarvestUiEvidence(stampResearch(normalizeAnalysis(parsed), harvest, searchActions), harvest)), brief)),
    { assetsRoot: UI_ASSETS_ROOT },
  )));
  return {
    analysis,
    usage: analysisEnvelope?.usage || harvestEnvelope?.usage || null,
    model: analysisEnvelope?.model || harvestEnvelope?.model || harvestRequest.model,
    research: { searchCalls: searchActions.length, actions: searchActions },
  };
}

async function testDeepSeekConnection() {
  if (!runtimeConfig.apiKey) {
    const error = new Error("尚未配置 DeepSeek API Key");
    error.status = 401;
    error.code = "KEY_NOT_CONFIGURED";
    throw error;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const requestBody = buildConnectionTestRequest(runtimeConfig.model);
    const response = await fetchWithRetry(chatEndpoint(runtimeConfig.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${runtimeConfig.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify(requestBody),
    }, fetch, 1);
    const raw = await response.text();
    if (!response.ok) {
      let detail = "";
      try {
        const parsed = JSON.parse(raw);
        detail = parsed?.error?.message || parsed?.message || "";
      } catch {
        detail = raw.slice(0, 240);
      }
      const error = new Error(`DeepSeek 连接测试失败（${response.status}）${detail ? `：${detail}` : ""}`);
      error.status = [400, 401, 402, 429].includes(response.status) ? response.status : 502;
      error.code = response.status === 401 ? "DEEPSEEK_AUTH_FAILED" : "DEEPSEEK_UPSTREAM_FAILED";
      throw error;
    }
    const envelope = JSON.parse(raw);
    connectionState.verified = true;
    connectionState.checkedAt = new Date().toISOString();
    return { model: envelope?.model || runtimeConfig.model, checkedAt: connectionState.checkedAt };
  } catch (error) {
    connectionState.verified = false;
    connectionState.checkedAt = new Date().toISOString();
    if (error.name === "AbortError") {
      const timeoutError = new Error("DeepSeek 连接测试超过 30 秒，请检查网络、代理或防火墙");
      timeoutError.status = 504;
      timeoutError.code = "DEEPSEEK_TEST_TIMEOUT";
      throw timeoutError;
    }
    if (error instanceof TypeError || error?.cause?.code) {
      const detail = friendlyNetworkError(error);
      const networkError = new Error(detail.message);
      networkError.status = 502;
      networkError.code = detail.code;
      throw networkError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const requested = path.resolve(PUBLIC, relative);
  if (!requested.startsWith(`${PUBLIC}${path.sep}`) && requested !== path.join(PUBLIC, "index.html")) {
    fail(res, 403, "禁止访问该路径", "FORBIDDEN");
    return;
  }
  try {
    const data = await fs.readFile(requested);
    res.writeHead(200, {
      "content-type": MIME[path.extname(requested).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none';",
    });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") return fail(res, 404, "页面不存在", "NOT_FOUND");
    throw error;
  }
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, {
        ok: true,
        keyConfigured: Boolean(runtimeConfig.apiKey),
        connectionVerified: connectionState.verified,
        connectionCheckedAt: connectionState.checkedAt,
        baseUrl: runtimeConfig.baseUrl,
        model: runtimeConfig.model,
        reportsRoot: REPORTS_ROOT,
        webResearch: true,
        officeExport: true,
        version: "1.2.0",
      });
    }
    if (req.method === "GET" && url.pathname === "/api/demo") {
      return json(res, 200, { ok: true, analysis: compileUiAuditFromScreens(structuredClone(DEMO_ANALYSIS)) });
    }
    if (req.method === "GET" && url.pathname === "/api/projects") {
      return json(res, 200, { ok: true, projects: await listReportProjects(REPORTS_ROOT) });
    }
    if (req.method === "GET" && url.pathname === "/api/projects/load") {
      const loaded = await readReportProject(REPORTS_ROOT, url.searchParams.get("id"));
      const analysis = compileUiAuditFromScreens(await enrichVisualEvidence(normalizeAnalysis(loaded.analysis), { assetsRoot: UI_ASSETS_ROOT }));
      if (JSON.stringify(analysis) !== JSON.stringify(loaded.analysis)) await fs.writeFile(loaded.projectPath, `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
      return json(res, 200, { ok: true, analysis, projectPath: loaded.projectPath });
    }
    if (req.method === "POST" && url.pathname === "/api/ui-evidence/capture") {
      const body = await readJson(req);
      const analysis = compileUiAuditFromScreens(await enrichVisualEvidence(await ensureUiSources(normalizeAnalysis(body.analysis || body)), { assetsRoot: UI_ASSETS_ROOT, force: true }));
      return json(res, 200, { ok: true, analysis, visualResearch: analysis.productExperience.visualResearch });
    }
    if (req.method === "POST" && url.pathname === "/api/config") {
      const body = await readJson(req);
      if (typeof body.apiKey === "string" && body.apiKey.trim()) runtimeConfig.apiKey = body.apiKey.trim();
      if (body.clearKey === true) runtimeConfig.apiKey = "";
      if (typeof body.baseUrl === "string" && body.baseUrl.trim()) runtimeConfig.baseUrl = validateBaseUrl(body.baseUrl.trim());
      if (typeof body.model === "string" && body.model.trim()) runtimeConfig.model = body.model.trim().slice(0, 100);
      connectionState.verified = false;
      connectionState.checkedAt = null;
      return json(res, 200, {
        ok: true,
        keyConfigured: Boolean(runtimeConfig.apiKey),
        connectionVerified: false,
        baseUrl: runtimeConfig.baseUrl,
        model: runtimeConfig.model,
        reportsRoot: REPORTS_ROOT,
      });
    }
    if (req.method === "POST" && url.pathname === "/api/test-model") {
      const result = await testDeepSeekConnection();
      return json(res, 200, { ok: true, connectionVerified: true, ...result });
    }
    if (req.method === "POST" && url.pathname === "/api/analyze") {
      const body = await readJson(req);
      const result = await callDeepSeek(body);
      return json(res, 200, { ok: true, ...result });
    }
    if (req.method === "POST" && url.pathname === "/api/normalize") {
      const body = await readJson(req);
      return json(res, 200, { ok: true, analysis: compileUiAuditFromScreens(normalizeAnalysis(body.analysis || body)) });
    }
    if (req.method === "POST" && url.pathname === "/api/export/pptx") {
      const body = await readJson(req);
      const analysis = compileUiAuditFromScreens(normalizeAnalysis(body.analysis || body));
      const buffer = await buildPptx(analysis);
      const saved = await saveReport({ analysis, extension: "pptx", data: buffer, reportsRoot: REPORTS_ROOT });
      return json(res, 200, { ok: true, ...saved });
    }
    if (req.method === "POST" && url.pathname === "/api/export/docx") {
      const body = await readJson(req);
      const analysis = compileUiAuditFromScreens(normalizeAnalysis(body.analysis || body));
      const buffer = await buildDocx(analysis, body.visualDataUrl || "");
      const saved = await saveReport({ analysis, extension: "docx", data: buffer, reportsRoot: REPORTS_ROOT });
      return json(res, 200, { ok: true, ...saved });
    }
    if (req.method === "POST" && url.pathname === "/api/export/json") {
      const body = await readJson(req);
      const analysis = compileUiAuditFromScreens(normalizeAnalysis(body.analysis || body));
      const saved = await saveReport({
        analysis,
        extension: "json",
        data: `${JSON.stringify(analysis, null, 2)}\n`,
        reportsRoot: REPORTS_ROOT,
      });
      return json(res, 200, { ok: true, ...saved });
    }
    if (req.method === "GET") return serveStatic(req, res, url.pathname);
    return fail(res, 405, "不支持的请求方法", "METHOD_NOT_ALLOWED");
  } catch (error) {
    const safe = error instanceof SyntaxError
      ? failDeepSeek(502, "DEEPSEEK_JSON_INVALID", "模型返回的 JSON 语法损坏。请重试一次，不要关闭页面。")
      : error;
    console.error(`[${new Date().toISOString()}] ${req.method} ${url.pathname}: ${safe.message}`);
    return fail(res, safe.status || 500, safe.message || "服务内部错误", safe.code || "INTERNAL_ERROR");
  }
}

const server = http.createServer(handle);
server.listen(PORT, HOST, () => {
  const address = `http://${HOST}:${PORT}`;
  console.log(`AI 竞品分析系统已启动：${address}`);
  console.log(`DeepSeek：${runtimeConfig.apiKey ? "已配置" : "待配置"}｜${runtimeConfig.model}｜${runtimeConfig.baseUrl}`);
  if (process.env.OPEN_BROWSER === "1" && process.platform === "win32") {
    const child = spawn("cmd.exe", ["/c", "start", "", address], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
  }
});

function shutdown(signal) {
  console.log(`\n收到 ${signal}，正在关闭本地服务…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
