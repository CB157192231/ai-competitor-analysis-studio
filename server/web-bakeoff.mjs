import { namesMatch, overlayBakeoffProbes, WEB_BAKEOFF_TASK_ID } from "../public/bakeoff.js";

const FETCH_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
};

const LOGIN_RE = /登录|登錄|验证码|驗證碼|扫码|掃碼|微信登录|钉钉|飛書登录|飞书登录|sso|手机号|手機號|验证后即可体验|驗證後即可體驗|立即登录|账号登录|企業登录|企业登录|验证后使用/iu;
const DOWNLOAD_RE = /立即下载|立即下載|下载客户端|下載客戶端|下载电脑版|下載電腦版|\.exe\b|仅桌面|僅桌面|desktop\s*app|下载安装|下載安裝/iu;
const WORKBENCH_RE = /<textarea\b|contenteditable|placeholder=["'][^"']{0,48}(输入|輸入|消息|任务|任務|prompt|问)/iu;
const MARKETING_RE = /解决方案|解決方案|客户案例|客戶案例|立即体验|立即體驗|免费试用|免費試用|产品优势|產品優勢|功能介绍|功能介紹/iu;
const KIND_RANK = { error: 0, thin: 1, marketing: 2, download_only: 3, login_wall: 4, workbench: 5 };

export const KNOWN_OFFICIAL_WEB = [
  { keys: ["qwenwork", "千问工作", "通义千问工作"], url: "https://qwenwork.cn/" },
  { keys: ["workbuddy"], url: "https://www.workbuddy.cn/app", fallbackUrl: "https://www.workbuddy.cn/" },
  { keys: ["豆包工作", "doubaowork"], url: "https://www.doubao.com/work" },
  { keys: ["trae"], url: "https://www.trae.cn/" },
];

function compactName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/gu, "");
}

function catalogHits(name, keys) {
  const compact = compactName(name);
  return keys.some((key) => {
    const needle = compactName(key);
    if (!compact || !needle) return false;
    if (compact === needle) return true;
    if (needle.length >= 4 && compact.includes(needle)) return true;
    if (compact.length >= 4 && needle.includes(compact)) return true;
    return namesMatch(name, key);
  });
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function countMatches(text, pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return (String(text || "").match(new RegExp(pattern.source, flags)) || []).length;
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyWebEntry(html, { url = "", status = 200, error = "" } = {}) {
  if (error || status === 0 || status >= 400) {
    return {
      kind: "error",
      reason: error || (status ? `HTTP ${status}` : "打开失败"),
    };
  }
  const raw = String(html || "");
  const text = stripHtml(raw);
  const loginHits = countMatches(text, LOGIN_RE);
  const downloadHits = countMatches(text, DOWNLOAD_RE);
  const workbenchHits = countMatches(raw, WORKBENCH_RE);
  const marketingHits = countMatches(text, MARKETING_RE);

  if (loginHits >= 2) {
    return { kind: "login_wall", reason: "页面要求登录后才能进入工作台" };
  }
  if (downloadHits >= 2 && workbenchHits === 0) {
    return { kind: "download_only", reason: "页面只提供客户端下载，没有网页工作台" };
  }
  if (workbenchHits >= 1) {
    return { kind: "workbench", reason: "页面可见工作台输入区" };
  }
  if (text.length < 120) {
    return { kind: "thin", reason: "页面几乎无内容，多为需前端渲染的壳" };
  }
  if (marketingHits >= 2) {
    return { kind: "marketing", reason: "打开的是营销或介绍页" };
  }
  return { kind: "marketing", reason: url ? "未见可执行工作台" : "未见可执行工作台" };
}

export function resolveWebEntry(competitor) {
  const name = String(competitor?.name || "").trim();
  if (!name) return null;
  const known = KNOWN_OFFICIAL_WEB.find((item) => catalogHits(name, item.keys));
  const url = known?.url || safeHttpUrl(competitor?.url);
  if (!url) return null;
  return {
    product: name,
    url,
    fallbackUrl: known?.fallbackUrl || "",
    from: known ? "catalog" : "competitor_url",
  };
}

function probeNote(kind, reason, error) {
  const extra = reason || error || "";
  return {
    login_wall: `已打开官方网页版，停在登录墙${extra ? `：${extra}` : "（手机号/微信/SSO）"}。未进入工作台，未代为提交任务。未跑。`,
    download_only: `已打开官方入口，页面只提供客户端下载，没有网页工作台。未下载安装包。未跑。`,
    workbench: "已打开网页工作台，可见输入区。本次调研不代为向竞品提交任务，格子保持未跑。",
    marketing: `已打开官方站点，看到的是营销/介绍页，未见可执行工作台。未跑。`,
    thin: "已请求官方网页版，页面几乎无内容（多为需登录后的前端壳）。未跑。",
    error: `打开官方网页版失败${extra ? `：${extra}` : ""}。未跑。`,
  }[kind] || `已打开官方网页版。${extra}未跑。`;
}

function publicPathForProbe(kind, url) {
  const href = safeHttpUrl(url);
  if (!href) return { channel: "none", url: "", stagesSeen: [], notes: "未见公开操作路径" };
  const stagesSeen = kind === "workbench" ? ["进入", "发起"] : kind === "error" ? ["进入"] : ["进入"];
  return {
    channel: "official_web",
    url: href,
    stagesSeen,
    notes: kind === "workbench" ? "官方网页工作台可打开，不是交差" : "官方网页版入口已打开，不是交差",
  };
}

export function probeToRun(product, classification, url) {
  const kind = classification?.kind || "error";
  return {
    product,
    kind,
    url: safeHttpUrl(url),
    status: "not_run",
    source: "measured",
    notes: probeNote(kind, classification?.reason),
    publicPath: publicPathForProbe(kind, url),
  };
}

export async function defaultFetchHtml(url, { timeout = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: FETCH_HEADERS,
    });
    const html = await response.text();
    return {
      url,
      finalUrl: response.url || url,
      status: response.status,
      html: html.slice(0, 250000),
    };
  } catch (error) {
    return {
      url,
      finalUrl: url,
      status: 0,
      html: "",
      error: error?.name === "AbortError" ? "超时" : (error?.message || String(error)),
    };
  } finally {
    clearTimeout(timer);
  }
}

function betterClassification(next, current) {
  return (KIND_RANK[next?.kind] || 0) > (KIND_RANK[current?.kind] || 0);
}

export async function probeOfficialWeb(entry, options = {}) {
  const fetchHtml = options.fetchHtml || defaultFetchHtml;
  const timeout = options.timeout ?? 12000;
  const first = await fetchHtml(entry.url, { timeout });
  let html = first.html || "";
  let finalUrl = first.finalUrl || entry.url;
  let status = first.status ?? 0;
  let error = first.error || "";
  let classification = classifyWebEntry(html, { url: finalUrl, status, error });

  if (
    (classification.kind === "thin" || classification.kind === "error")
    && entry.fallbackUrl
    && entry.fallbackUrl !== entry.url
  ) {
    const second = await fetchHtml(entry.fallbackUrl, { timeout });
    const next = classifyWebEntry(second.html || "", {
      url: second.finalUrl || entry.fallbackUrl,
      status: second.status ?? 0,
      error: second.error || "",
    });
    if (betterClassification(next, classification) || (classification.kind === "error" && next.kind !== "error")) {
      finalUrl = second.finalUrl || entry.fallbackUrl;
      classification = next;
    }
  }

  return probeToRun(entry.product, classification, finalUrl);
}

function shouldSkip(analysis, options = {}) {
  if (options.skip) return { skip: true, reason: "explicit" };
  if (process.env.WEB_BAKEOFF === "0") return { skip: true, reason: "WEB_BAKEOFF=0" };
  if (analysis?.research?.mode === "demo") return { skip: true, reason: "demo" };
  return { skip: false, reason: "" };
}

export async function applyLiveWebBakeoff(analysis, options = {}) {
  const skipped = shouldSkip(analysis, options);
  if (skipped.skip) return analysis;
  const competitors = Array.isArray(analysis?.competitors) ? analysis.competitors : [];
  const entries = competitors.map(resolveWebEntry).filter(Boolean).slice(0, 6);
  if (!entries.length) return analysis;

  const probes = await Promise.all(entries.map((entry) => (
    probeOfficialWeb(entry, options).catch((error) => probeToRun(entry.product, {
      kind: "error",
      reason: error?.message || String(error),
    }, entry.url))
  )));

  const bakeoff = overlayBakeoffProbes(analysis, probes, options.taskId || WEB_BAKEOFF_TASK_ID);
  const limitations = (Array.isArray(analysis.limitations) ? analysis.limitations : [])
    .filter((item) => !/尚未完成黄金任务/.test(String(item)));
  if (bakeoff.scorecard?.probedRunCount && !limitations.some((item) => /网页版实测|登录墙/.test(String(item)))) {
    limitations.push("本次调研已打开各竞品官方网页版，实测同一条带来源研究任务。登录墙或仅下载仍标未跑，不能写成交差。");
  }

  return {
    ...analysis,
    bakeoff,
    limitations,
    research: {
      ...(analysis.research || {}),
      webBakeoff: {
        ranAt: new Date().toISOString(),
        taskId: options.taskId || WEB_BAKEOFF_TASK_ID,
        probes: probes.map((item) => ({
          product: item.product,
          kind: item.kind,
          url: item.url,
          notes: item.notes,
        })),
      },
    },
  };
}
