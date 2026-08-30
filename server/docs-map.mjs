import { isKnowledgeInnerUrl, KNOWLEDGE_PATH_RE } from "./source-harvest.mjs";

const SKIP_DOC_RE = /pricing|download-history|changelog|invoice|billing|careers|contact\/?$/iu;

export const KNOWN_DOCS = [
  {
    keys: ["workbuddy"],
    hubUrl: "https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project",
    platforms: [
      { name: "电脑端 / Web 工作台", channel: "desktop", url: "https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project", note: "主执行环境：任务、项目、连接器、本地工作空间都在这里跑" },
      { name: "微信小程序", channel: "miniprogram", url: "https://www.codebuddy.cn/docs/workbuddymini/quick-start/Overview", note: "云上沙箱或远程操控电脑端，手机下达任务" },
      { name: "移动端 App / 助理", channel: "mobile", url: "https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Assistant", note: "微信/企微/QQ/钉钉/飞书远程控制电脑，电脑需保持在线" },
      { name: "企业版", channel: "enterprise", url: "https://cloud.tencent.com/document/product/1831/134405", note: "席位、SSO、审计与专有云，和个人员工工作台不是同一套管理面" },
    ],
    modules: [
      { name: "新建任务栏", group: "工作台", href: "https://www.workbuddy.cn/docs/workbuddy/Create-Task" },
      { name: "设计创意", group: "工作台" },
      { name: "助理", group: "远程", href: "https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Assistant" },
      { name: "项目", group: "协作", href: "https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project" },
      { name: "专家", group: "能力" },
      { name: "技能", group: "能力" },
      { name: "灵感", group: "发现" },
      { name: "我的邮箱", group: "连接" },
      { name: "连接器", group: "连接", href: "https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project" },
      { name: "资料库", group: "资产" },
      { name: "内容管理", group: "资产" },
      { name: "多人多 Agent 协作", group: "协作" },
      { name: "轻量发布", group: "交付" },
      { name: "应用", group: "扩展" },
      { name: "腾讯文档", group: "连接" },
      { name: "ima 知识库", group: "连接" },
      { name: "乐享知识库", group: "连接" },
      { name: "人机双号", group: "治理" },
      { name: "自动化", group: "编排" },
      { name: "右侧边栏", group: "框架" },
      { name: "系统设置", group: "治理" },
      { name: "默认权限与安全沙箱", group: "治理" },
    ],
    settings: [
      { name: "项目指令 / 专家 / Skill / 连接器", purpose: "团队共享上下文，创建任务时自动注入" },
      { name: "公共授权 vs 个人授权", purpose: "连接器票据是全员共用还是成员各自授权" },
      { name: "助理设置", purpose: "绑定微信/企微/QQ/钉钉/飞书作为手机遥控器" },
    ],
    notes: [
      "官方文档把功能说明做成独立侧栏：项目、连接器、助理、技能不是首页四个按钮，而是完整模块树。",
      "电脑端是执行面，小程序/App/IM 助理是控制面，企业版是管理面。",
      "输入条模式菜单提供 Ask 仅问答、Plan 先计划、Craft 默认执行；优设完整指南：https://www.uisdc.com/workbuddy-complete-guide",
    ],
  },
  {
    keys: ["qwenwork", "千问办公"],
    hubUrl: "https://qwenwork.cn/docs/desktop/settings",
    platforms: [
      { name: "Web 端", channel: "web", url: "https://qwenwork.cn/docs/getting-started/web-workflow", note: "浏览器 qwenwork.cn/app，可嵌在钉钉里" },
      { name: "桌面 Windows", channel: "desktop", url: "https://qwenwork.cn/docs/install/windows", note: "Win10+ 64 位客户端" },
      { name: "桌面 macOS", channel: "desktop", url: "https://qwenwork.cn/docs/install/macos", note: "macOS 14+，Apple / Intel 双包" },
      { name: "HarmonyOS 电脑", channel: "desktop", url: "https://qwenwork.cn/docs/install/harmonyos", note: "鸿蒙 6.1+，华为应用市场分发" },
      { name: "钉钉内", channel: "mobile", url: "https://qwenwork.cn/docs/getting-started/web-workflow", note: "文档写明可从钉钉进入，移动响应场景" },
    ],
    modules: [
      { name: "Web 端使用链路", group: "入门", href: "https://qwenwork.cn/docs/getting-started/web-workflow" },
      { name: "桌面端使用链路", group: "入门", href: "https://qwenwork.cn/docs/getting-started/desktop-workflow" },
      { name: "我的网页", group: "平台" },
      { name: "个人云盘", group: "平台" },
      { name: "扩展：专家插件 / 技能", group: "扩展" },
      { name: "自定义任务", group: "编排" },
      { name: "连接器", group: "扩展" },
      { name: "专家套件", group: "扩展" },
      { name: "工作台", group: "框架" },
      { name: "电脑操控", group: "执行" },
      { name: "IM / Hooks", group: "连接" },
      { name: "系统设置", group: "治理", href: "https://qwenwork.cn/docs/desktop/settings" },
    ],
    settings: [
      { name: "偏好设置", purpose: "语言、主题、字号、预览方式、提示词建议、默认展开工具调用" },
      { name: "个人资料", purpose: "账号身份" },
      { name: "系统设置", purpose: "客户端全局行为" },
      { name: "语音输入", purpose: "音频交互" },
      { name: "应用快照", purpose: "状态/历史快照" },
      { name: "快捷键", purpose: "键盘效率" },
      { name: "意识", purpose: "桌面端上下文感知与自动记忆" },
      { name: "工作台（Beta）", purpose: "扩展与集成入口" },
      { name: "安全工作环境", purpose: "企业安全边界" },
      { name: "实验特性", purpose: "未稳定能力开关" },
    ],
    notes: [
      "帮助中心按端拆手册：Web、Windows、macOS、HarmonyOS 不是同一条安装/权限链路。",
      "设置页是典型 master-detail：左侧设置分组，右侧开关/下拉，这就是框架层证据。",
    ],
  },
  {
    keys: ["traework", "trae"],
    hubUrl: "https://docs.trae.cn/work_trae-work-web-and-desktop-quickstart",
    platforms: [
      { name: "Web", channel: "web", url: "https://docs.trae.cn/work_trae-work-web-and-desktop-quickstart", note: "浏览器工作台" },
      { name: "桌面客户端", channel: "desktop", url: "https://docs.trae.cn/work_trae-work-web-and-desktop-quickstart", note: "本地/云端运行环境不同" },
    ],
    modules: [
      { name: "Work 模式", group: "分流" },
      { name: "Code 模式", group: "分流" },
      { name: "Design 模式", group: "分流" },
      { name: "项目 / 任务", group: "对象" },
      { name: "Todos / 产物面板", group: "执行" },
    ],
    settings: [],
    notes: ["文档把 Web 和 Desktop 写在同一条 quickstart 里，但运行环境要用户自己选。"],
  },
  {
    keys: ["doubaowork", "豆包工作"],
    hubUrl: "https://developer.volcengine.com/articles/7678191962070974500",
    platforms: [
      { name: "豆包工作电脑版", channel: "desktop", url: "https://www.doubao.com/work", note: "Win/Mac 独立客户端，授权本地目录后执行" },
      { name: "豆包电脑版内置", channel: "desktop", url: "https://www.doubao.com/work", note: "升级豆包电脑版后可直接用工作模式" },
      { name: "手机遥控电脑", channel: "mobile", url: "https://www.doubao.com/work", note: "侧栏一级入口；不在电脑旁也能派发任务" },
      { name: "豆包 App", channel: "mobile", url: "https://www.doubao.com/work", note: "个人流量入口，和工作电脑版不是同一套导航" },
      { name: "团队版 / 飞书", channel: "enterprise", url: "https://www.doubao.com/work/group", note: "飞书账号、企业权限和产物回写飞书" },
    ],
    modules: [
      { name: "新工作任务", group: "工作台" },
      { name: "定时任务", group: "编排" },
      { name: "技能 · 连接器 · 伙伴", group: "能力" },
      { name: "伙伴对话", group: "协作" },
      { name: "云盘", group: "资产" },
      { name: "手机遥控电脑", group: "远程" },
    ],
    settings: [
      { name: "本地目录授权", purpose: "电脑版第一次使用要指定工作目录，只碰这个目录" },
      { name: "飞书企业权限", purpose: "团队版只访问你飞书权限范围内的内容" },
    ],
    notes: [
      "豆包工作是 7 月 30 日飞书产品团队和豆包产品团队整合后的第一款 Agent，飞书账号原生登录。",
      "登录后继承企业 AI 额度、文档、多维表格、知识库、聊天、邮件和飞书权限系统；左下角展示企业与实名。",
      "没有 WorkBuddy/千问那种完整 docs 侧栏，功能树以电脑版左侧导航和优设实机文为准：https://www.uisdc.com/feishu-agent",
      "电脑执行 + 云电脑长任务 + 手机遥控是产品结构；产物可回写飞书。不要用 bibigpt 或营销页代替。",
    ],
  },
  {
    keys: ["microsoft365copilot", "microsoftcopilot"],
    hubUrl: "https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/ux-custom-engine-agent",
    platforms: [
      { name: "Microsoft 365 Web", channel: "web", url: "https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/ux-custom-engine-agent", note: "套件内 Agent 对话" },
      { name: "Teams / Outlook", channel: "desktop", note: "能力挂在已有办公入口，而不是独立工作台" },
      { name: "移动端 Office / Teams", channel: "mobile", note: "随套件分发，不是单独的任务监控 App" },
    ],
    modules: [
      { name: "Agent 身份与提示卡片", group: "进入" },
      { name: "流式对话", group: "执行" },
      { name: "引用 / 来源", group: "治理" },
    ],
    settings: [],
    notes: ["端覆盖跟 Office 套件走，没有独立的「电脑版 vs 小程序」文档树。"],
  },
  {
    keys: ["autodeskacc", "constructioncloud", "autodeskboards"],
    hubUrl: "https://help.autodesk.com/view/DOCS/ENU/",
    platforms: [
      { name: "ACC Web", channel: "web", url: "https://help.autodesk.com/view/DOCS/ENU/", note: "项目主页、Docs/Build/Issues 是分模块 IA" },
      { name: "ACC Learn 课程", channel: "web", url: "https://learnacc.autodesk.com/page/courses", note: "官方学习中心内页，不是 construction.autodesk.com 营销首页" },
      { name: "Boards / 预施工", channel: "web", url: "https://boards.autodesk.com/pre-construction/", note: "产品站入口；去掉联盟参数后再进 help/learn/app，不要把 cj 追踪链当 UI" },
      { name: "现场移动端", channel: "mobile", url: "https://help.autodesk.com/view/DOCS/ENU/", note: "照片、问题、RFI 常从手机进入" },
    ],
    modules: [
      { name: "项目主页", group: "进入", href: "https://help.autodesk.com/view/DOCS/ENU/" },
      { name: "Docs", group: "文档" },
      { name: "Build / Issues / RFI", group: "现场" },
      { name: "Learn 课程目录", group: "学习", href: "https://learnacc.autodesk.com/page/courses" },
      { name: "Pre-construction Boards", group: "预施工", href: "https://boards.autodesk.com/pre-construction/" },
    ],
    settings: [],
    notes: [
      "help.autodesk.com 与 learnacc.autodesk.com、boards.autodesk.com 是不同主机，搜完 docs 必须再 site: 学习中心和产品站内页。",
      "带 cjdata/AID/PID 的 boards 链接只是联盟落地，canonicalize 后再跟内页。",
    ],
  },
  {
    keys: ["aecore", "广联达aecore", "glodonaecore"],
    hubUrl: "https://aecore.glodon.com/docs/aecore/guide_1_preview.html",
    platforms: [
      { name: "AECORE 开发者控制台", channel: "web", url: "https://aecore.glodon.com/docs/aecore/guide_1_preview.html#%E6%88%90%E4%B8%BA%E5%BC%80%E5%8F%91%E8%80%85", note: "文档是单页 + 侧栏锚点，不是多个独立 Overview" },
    ],
    modules: [
      { name: "成为开发者", group: "新手入门", href: "https://aecore.glodon.com/docs/aecore/guide_1_preview.html#%E6%88%90%E4%B8%BA%E5%BC%80%E5%8F%91%E8%80%85" },
      { name: "创建一个应用", group: "新手入门", href: "https://aecore.glodon.com/docs/aecore/guide_1_preview.html" },
      { name: "开通订阅服务", group: "新手入门", href: "https://aecore.glodon.com/docs/aecore/guide_1_preview.html#%E5%BC%80%E9%80%9A%E8%AE%A2%E9%98%85%E6%9C%8D%E5%8A%A1" },
    ],
    settings: [],
    notes: [
      "广联达 AECORE 文档树在 aecore.glodon.com/docs，侧栏「新手入门」下的成为开发者/创建应用/开通订阅是 hash 内页，必须带 # 写入证据。",
      "控制台截图（全部产品与服务、立即开通）算 official_tutorial，不要停在产品介绍首页。",
    ],
  },
];

function compactName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/gu, "");
}

export function knownDocsFor(name) {
  const compact = compactName(name);
  if (!compact) return null;
  return KNOWN_DOCS.find((item) => item.keys.some((key) => {
    if (key.length >= 6) return compact.includes(key) || (compact.length >= 6 && key.includes(compact));
    return compact === key || compact.startsWith(key) || compact.endsWith(key);
  })) || null;
}

function mergeNamed(base = [], extra = []) {
  const out = [];
  const seen = new Set();
  for (const item of [...base, ...extra]) {
    const name = String(item?.name || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      group: String(item.group || item.channel || "").trim(),
      channel: String(item.channel || "").trim(),
      href: String(item.href || item.url || "").trim(),
      url: String(item.url || item.href || "").trim(),
      note: String(item.note || item.purpose || "").trim(),
      purpose: String(item.purpose || item.note || "").trim(),
    });
  }
  return out;
}

export function seedKnownDocsMap(productAudit) {
  const known = knownDocsFor(productAudit?.competitorName);
  if (!known) return productAudit;
  const current = productAudit.docsMap || {};
  const modules = mergeNamed(known.modules, current.modules);
  const platforms = mergeNamed(known.platforms, current.platforms);
  productAudit.docsMap = {
    hubUrl: current.hubUrl || known.hubUrl,
    sourceType: "official_docs",
    platforms: platforms.length >= known.platforms.length ? platforms : mergeNamed(known.platforms, current.platforms),
    modules: modules.length >= known.modules.length ? modules : mergeNamed(known.modules, current.modules),
    settings: mergeNamed(known.settings, current.settings),
    notes: [...new Set([...(known.notes || []), ...(current.notes || [])].filter(Boolean))],
  };
  return productAudit;
}

export function isDocsNavLink(href, text = "") {
  return isKnowledgeInnerUrl(href, text);
}

function platformFromText(text, href = "") {
  const hay = `${text} ${href}`;
  if (/小程序|mini-?program|workbuddymini/iu.test(hay)) return { name: String(text || "小程序").trim() || "小程序", channel: "miniprogram" };
  if (/移动|mobile|android|ios|app(?![a-z])/iu.test(hay)) return { name: String(text || "移动端").trim() || "移动端", channel: "mobile" };
  if (/企业版|enterprise|teams?版/iu.test(hay)) return { name: String(text || "企业版").trim() || "企业版", channel: "enterprise" };
  if (/harmony|鸿蒙/iu.test(hay)) return { name: String(text || "HarmonyOS").trim() || "HarmonyOS", channel: "desktop" };
  if (/windows|macos|桌面|电脑|desktop|客户端/iu.test(hay)) return { name: String(text || "电脑端").trim() || "电脑端", channel: "desktop" };
  if (/web|网页/iu.test(hay)) return { name: String(text || "Web").trim() || "Web", channel: "web" };
  return null;
}

export async function extractDocsMapFromPage(page) {
  const host = new URL(page.url()).hostname;
  const extracted = await page.evaluate(({ hostName, pathRe }) => {
    const knowledgePath = new RegExp(pathRe, "iu");
    const seen = new Set();
    const modules = [];
    const platforms = [];
    const header = document.querySelector("header, .navbar, nav");
    const navRoots = [
      document.querySelector("aside"),
      document.querySelector("nav"),
      document.querySelector("[class*='sidebar']"),
      document.querySelector("[class*='menu']"),
      header,
    ].filter(Boolean);
    const anchors = [];
    for (const root of navRoots) anchors.push(...root.querySelectorAll("a[href]"));
    if (!anchors.length) anchors.push(...document.querySelectorAll("a[href]"));
    for (const anchor of anchors) {
      try {
        const url = new URL(anchor.href, location.href);
        const sameRoot = url.hostname === hostName || url.hostname.endsWith(`.${hostName.split(".").slice(-2).join(".")}`);
        if (!sameRoot && !/docs|help|learn|boards|aecore|developer|academy/iu.test(url.hostname)) continue;
        const hashName = decodeURIComponent((url.hash || "").replace(/^#/, "")).trim();
        const text = (anchor.textContent || "").replace(/\s+/g, " ").trim() || hashName;
        if (!text || text.length > 48) continue;
        const hay = `${text} ${url.pathname} ${hashName}`.toLowerCase();
        const platform = (() => {
          if (/小程序/.test(text)) return { name: text, channel: "miniprogram", url: url.href };
          if (/移动端|App/.test(text) && /docs|workbuddy|qwen/iu.test(url.href)) return { name: text, channel: "mobile", url: url.href };
          if (/企业版/.test(text)) return { name: text, channel: "enterprise", url: url.href };
          if (/Harmony|鸿蒙|Windows|macOS|桌面端|电脑版/.test(text)) return { name: text, channel: "desktop", url: url.href };
          if (/Web端|网页端/.test(text)) return { name: text, channel: "web", url: url.href };
          return null;
        })();
        if (platform && !platforms.some((item) => item.name === platform.name)) platforms.push(platform);
        if (!knowledgePath.test(url.pathname) && !url.hash && !/learn|boards|aecore|docs|help/iu.test(url.hostname)) continue;
        if (/pricing|changelog|invoice|billing|careers|contact/iu.test(hay) && !/course|guide|订阅|开发者/iu.test(hay)) continue;
        if (seen.has(url.href) || seen.has(text)) continue;
        seen.add(url.href);
        seen.add(text);
        const group = (anchor.closest("li, div")?.parentElement?.previousElementSibling?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 20);
        modules.push({ name: text, href: url.href, group });
      } catch {
        // ignore
      }
    }
    return {
      hubUrl: location.href,
      modules: modules.slice(0, 48),
      platforms: platforms.slice(0, 8),
    };
  }, { hostName: host, pathRe: KNOWLEDGE_PATH_RE.source });
  return extracted;
}

export function attachExtractedDocsMap(productAudit, extracted) {
  if (!extracted) return productAudit;
  const current = productAudit.docsMap || {};
  productAudit.docsMap = {
    hubUrl: extracted.hubUrl || current.hubUrl,
    sourceType: "official_docs",
    platforms: mergeNamed(current.platforms, extracted.platforms),
    modules: mergeNamed(extracted.modules, current.modules),
    settings: current.settings || [],
    notes: current.notes || [],
  };
  return productAudit;
}

export { SKIP_DOC_RE, platformFromText };
