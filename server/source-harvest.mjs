const SECONDARY_WALKTHROUGH_HOST_RE = /(?:^|\.)(?:uisdc\.com|zhihu\.com|zhimg\.com|sspai\.com|juejin\.cn|csdn\.net|jianshu\.com|medium\.com|dev\.to|notion\.so|reddit\.com|stackoverflow\.com|xiaohongshu\.com|xhslink\.com|pconline\.com\.cn|36kr\.com|ithome\.com|geekpark\.net|leiphone\.com|infoq\.cn)$/iu;
const VIDEO_HOST_RE = /(?:^|\.)(?:youtube\.com|youtu\.be|bilibili\.com|b23\.tv)$/iu;
const JUNK_WALKTHROUGH_RE = /bibigpt\.co|aibase\.cn\/tool|ai-bot\.cn/iu;
const TRACKING_PARAM_RE = /^(?:utm_|utm$|cjdata|cjevent|cj_|affname|affiliate|aff_|fbclid|gclid|msclkid|mc_|pk_|mktvar|campaignid|dclid)[^=]*$|^(?:AID|PID|SID|affid|clickid)$/iu;
const AFFILIATE_QUERY_RE = /(?:^|[?&])(?:cjdata|cjevent|affname|AID|PID|mktvar\d*|gclid|fbclid|msclkid)=/iu;
const KNOWLEDGE_PATH_RE = /\/docs\/|\/help\/|\/learn\/|\/guide\/|\/support\/|\/manual\/|\/kb\/|\/page\/|\/view\/|\/courses?(?:\/|$)|\/course\/|\/tutorial\/|\/academy\/|\/getting-started\/|\/quick-?start\/|\/developer\/|\/console\/|\/preview(?:[./]|$)/iu;
const KNOWLEDGE_HOST_RE = /(?:^|\.)(?:docs|help|support|developer|dev|academy|university|knowledge|learn)[^.]*\./iu;
const PRODUCT_APP_HOST_RE = /(?:^|\.)(?:boards|acc|learnacc|help|docs|developer|forma|construction|aecore)\.[a-z0-9.-]+$/iu;
const AEC_NAME_RE = /autodesk|acc\b|procore|glodon|广联达|aecore|bim|construction|forma|boards/iu;
const SKIP_DOC_RE = /pricing|download-history|changelog|invoice|billing|careers|contact\/?$/iu;

export function publicHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    const host = url.hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "::1"].includes(host) || host.endsWith(".local")) return "";
    if (/^(?:10|127|169\.254|192\.168)\./u.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./u.test(host)) return "";
    return url.href;
  } catch {
    return "";
  }
}

export function canonicalizeHarvestUrl(value) {
  const url = publicHttpUrl(value);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAM_RE.test(key)) parsed.searchParams.delete(key);
    }
    parsed.search = parsed.searchParams.toString();
    return parsed.href;
  } catch {
    return url;
  }
}

export function isAffiliateLanding(value) {
  return AFFILIATE_QUERY_RE.test(String(value || ""));
}

export function registrableDomain(hostname) {
  const host = String(hostname || "").toLowerCase();
  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return host;
  return parts.slice(-2).join(".");
}

export function isOfficialKnowledgeHost(value) {
  const url = canonicalizeHarvestUrl(value) || publicHttpUrl(value);
  if (!url) return false;
  const host = new URL(url).hostname.toLowerCase();
  if (KNOWLEDGE_HOST_RE.test(`${host}.`)) return true;
  if (PRODUCT_APP_HOST_RE.test(host)) return true;
  return false;
}

export function isKnowledgeInnerUrl(value, text = "") {
  const raw = publicHttpUrl(value);
  if (!raw) return false;
  if (isAffiliateLanding(raw)) return false;
  try {
    const url = new URL(canonicalizeHarvestUrl(raw));
    const hay = `${text} ${url.pathname} ${decodeURIComponent(url.hash || "")}`.toLowerCase();
    if (SKIP_DOC_RE.test(hay) && !/function-description|settings|project|task|workspace|assistant|connector|course|guide|preview/iu.test(hay)) {
      return false;
    }
    if (KNOWLEDGE_PATH_RE.test(url.pathname)) return true;
    if (url.hash && /\/docs\/|\/help\/|\/guide\/|\/learn\//iu.test(url.pathname)) return true;
    if (isOfficialKnowledgeHost(url.href) && url.pathname.replace(/\/+$/u, "") && url.pathname !== "/") {
      if (/\/(?:pricing|download|sem[-_]|campaign)/iu.test(url.pathname)) return false;
      const depth = url.pathname.replace(/\/+$/u, "").split("/").filter(Boolean).length;
      if (!KNOWLEDGE_PATH_RE.test(url.pathname) && depth <= 1) return false;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function sameKnowledgeFamily(a, b) {
  try {
    const hostA = new URL(canonicalizeHarvestUrl(a) || a).hostname.toLowerCase();
    const hostB = new URL(canonicalizeHarvestUrl(b) || b).hostname.toLowerCase();
    if (hostA === hostB) return true;
    if (registrableDomain(hostA) !== registrableDomain(hostB)) return false;
    return KNOWLEDGE_HOST_RE.test(`${hostA}.`) || KNOWLEDGE_HOST_RE.test(`${hostB}.`) || PRODUCT_APP_HOST_RE.test(hostA) || PRODUCT_APP_HOST_RE.test(hostB);
  } catch {
    return false;
  }
}

export function isSecondaryWalkthroughHost(value) {
  const url = publicHttpUrl(value);
  if (!url) return false;
  return SECONDARY_WALKTHROUGH_HOST_RE.test(new URL(url).hostname.toLowerCase());
}

export function isVideoHost(value) {
  const url = publicHttpUrl(value);
  if (!url) return false;
  const parsed = new URL(url);
  return VIDEO_HOST_RE.test(parsed.hostname.toLowerCase());
}

export function isLowQualityWalkthrough(value) {
  return JUNK_WALKTHROUGH_RE.test(String(value || ""));
}

export function parseVideoSeconds(value) {
  const url = publicHttpUrl(value);
  if (!url) return 0;
  try {
    const parsed = new URL(url);
    const raw = parsed.searchParams.get("t") || parsed.searchParams.get("start") || (parsed.hash.match(/t=([\d.]+)/u) || [])[1] || "";
    if (!raw) return 0;
    if (/^\d+(?:\.\d+)?$/u.test(raw)) return Math.max(1, Math.round(Number(raw)));
    let total = 0;
    const hours = raw.match(/(\d+)h/iu);
    const minutes = raw.match(/(\d+)m/iu);
    const seconds = raw.match(/(\d+)s/iu);
    if (hours) total += Number(hours[1]) * 3600;
    if (minutes) total += Number(minutes[1]) * 60;
    if (seconds) total += Number(seconds[1]);
    return total || 0;
  } catch {
    return 0;
  }
}

export function stampVideoTiming(audit = {}) {
  const seconds = Math.max(0, Number(audit.videoSeconds) || parseVideoSeconds(audit.sourceUrl) || 0);
  if (!seconds) return audit;
  audit.videoSeconds = seconds;
  if (!audit.videoTimestamp) audit.videoTimestamp = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return audit;
}

const LOGO_HINT_RE = /logo|favicon|icon|avatar|banner|hero|cover|qrcode|二维码|opengraph|og-image|apple-touch|wordmark|sprite/iu;
const UI_HINT_RE = /screenshot|screen-?shot|interface|workspace|workbench|console|dashboard|toolbar|sidebar|dialog|modal|window|taskbar|settings|截图|界面|工作台|控制台|侧栏|后台|对话框|设置页|操作界面|软件界面/iu;
const UI_IMAGE_MIN_SCORE = 6;

export function scoreUiImageCandidate(item = {}) {
  const src = String(item.src || item.url || "");
  const alt = String(item.alt || "");
  const nearbyText = String(item.nearbyText || "");
  const width = Math.max(0, Number(item.width) || 0);
  const height = Math.max(0, Number(item.height) || 0);
  const text = `${src} ${alt} ${nearbyText}`;
  if (!/^https?:\/\//iu.test(src)) return { score: 0, accepted: false, reasons: ["not-http"] };
  if (LOGO_HINT_RE.test(text) && !UI_HINT_RE.test(text)) {
    return { score: -12, accepted: false, reasons: ["logo-or-marketing-art"] };
  }

  const reasons = [];
  let score = Math.min(6, Math.log2(Math.max(1, width * height) / 80000 + 1));
  if (UI_HINT_RE.test(text)) {
    score += 5;
    reasons.push("ui-keyword");
  }
  if (width >= 800 && height >= 450 && width / height >= 1.15 && width / height <= 2.6) {
    score += 4;
    reasons.push("desktop-frame");
  }
  if (width >= 320 && width <= 520 && height >= 560 && height / width >= 1.4 && height / width <= 2.4) {
    score += 3;
    reasons.push("mobile-frame");
  }
  if ((width < 400 || height < 220) && !/zhimg\.com|sspai\.com/iu.test(src)) {
    score -= 6;
    reasons.push("too-small");
  }
  if (width >= 280 && height >= 280 && Math.abs(width - height) / Math.max(width, height) < 0.12) {
    score -= 8;
    reasons.push("square-icon");
  }
  if (width / Math.max(1, height) > 4.2 || height / Math.max(1, width) > 3.4) {
    score -= 6;
    reasons.push("banner-aspect");
  }
  return { score, accepted: score >= UI_IMAGE_MIN_SCORE, reasons };
}

export function isLikelyAppUiImage(item) {
  return scoreUiImageCandidate(item).accepted;
}

export function harvestSearchBudget(productCount = 1) {
  return Math.min(20, Math.max(12, Number(productCount || 1) * 3 + 4));
}

export function buildHarvestQueries(productName) {
  const name = String(productName || "").trim();
  if (!name) return [];
  const queries = [
    `${name} (界面 OR 软件界面 OR 操作界面 OR 工作台 OR 控制台) (截图 OR screenshot OR UI)`,
    `${name} (教程 OR tutorial OR walkthrough OR 使用指南 OR 实操) (截图 OR 步骤 OR screenshot)`,
    `${name} (文档 OR 帮助中心 OR docs OR help OR learn OR 开发者文档 OR 快速开始)`,
    `${name} (inurl:docs OR inurl:help OR inurl:learn OR inurl:guide OR inurl:courses OR inurl:tutorial)`,
  ];
  if (AEC_NAME_RE.test(name)) {
    queries.push(`${name} (site:help.autodesk.com OR site:learnacc.autodesk.com OR site:boards.autodesk.com OR site:aecore.glodon.com)`);
  } else {
    queries.push(`${name} (保姆级 OR 完整指南 OR 实操) (site:uisdc.com OR site:zhuanlan.zhihu.com OR site:bilibili.com)`);
  }
  return queries;
}

export function harvestQueryPlaybook(names = []) {
  const products = (Array.isArray(names) ? names : []).map((item) => String(item || "").trim()).filter(Boolean);
  const budget = harvestSearchBudget(products.length || 1);
  return `搜索预算全部产品合计最多 ${budget} 次（含打开页面）。流程固定为：全网关键词搜网页 → 打开页面 → 匹配页内图片是否为应用 UI → 通过后再交给下载分析。禁止停在官网首页、Overview、SEM、下载页或带 cjdata/AID/PID 的联盟落地页。
1) 全网关键词（不要一上来就 site:）：{产品} 界面/工作台/控制台 截图 screenshot UI；{产品} 教程/walkthrough 步骤 截图。任何域名的结果都可以进候选。
2) 打开命中页后，只保留像软件界面的图（侧栏、工具栏、对话框、工作台、控制台；宽屏截图或手机竖屏）。Logo、KV、头图、二维码、信息图不算 UI，不得下载。
3) 知识站第二跳：docs/help/learn/courses 与 hash 内页。联盟链接先去参。AEC 不要套优设/飞书。
形态：https://aecore.glodon.com/docs/aecore/guide_1_preview.html#%E6%88%90%E4%B8%BA%E5%BC%80%E5%8F%91%E8%80%85 ；https://learnacc.autodesk.com/page/courses`;
}

export function walkthroughHarvestRules() {
  return `官方文档不够时，先全网关键词再打开网页看图，禁止停在官网首页/SEM/下载页/联盟追踪落地页，也禁止 bibigpt 一类评测站水文。
A. 关键词：界面、工作台、控制台、截图、screenshot、tutorial、walkthrough。命中任意网页后必须检查页内图片是否为应用 UI，通过才写入 uiEvidence。
B. 官方 docs/help/learn/courses 侧栏与 #锚点仍要打开。ACC/Boards/AECORE 不要套飞书或优设。
C. 第三方保姆级必须能看到实机界面。办公类参考优设/知乎；AEC 类 Autodesk University / YouTube / learnacc。
D. 视频：sourceType=video_walkthrough，URL 带 t= 并填写 videoSeconds。封面、口播、广告不算。
身份事实写入 evidence。`;
}

export {
  SECONDARY_WALKTHROUGH_HOST_RE,
  VIDEO_HOST_RE,
  JUNK_WALKTHROUGH_RE,
  KNOWLEDGE_PATH_RE,
  KNOWLEDGE_HOST_RE,
  PRODUCT_APP_HOST_RE,
  UI_IMAGE_MIN_SCORE,
};
