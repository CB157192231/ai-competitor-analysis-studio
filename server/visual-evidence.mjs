import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { namesLikelySame } from "./analysis.mjs";
import { attachExtractedDocsMap, extractDocsMapFromPage, isDocsNavLink, seedKnownDocsMap } from "./docs-map.mjs";
import {
  canonicalizeHarvestUrl,
  isAffiliateLanding,
  isKnowledgeInnerUrl,
  isLikelyAppUiImage,
  isLowQualityWalkthrough,
  isOfficialKnowledgeHost,
  isSecondaryWalkthroughHost,
  parseVideoSeconds,
  sameKnowledgeFamily,
  scoreUiImageCandidate,
  stampVideoTiming,
} from "./source-harvest.mjs";

const CHROME_PATHS = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"];
const DOC_PAGE_RE = /\/docs\/|\/help\/|\/learn\/|\/guide\/|\/support\/|\/manual\/|\/kb\/|\/page\/|\/view\/|\/courses?(?:\/|$)|\/tutorial\/|\/academy\//iu;
const SKIP_DOC_RE = /pricing|download-history|changelog|invoice|billing|careers|contact\/?$/iu;
const MARKETING_PATH_RE = /\/sem[-_]|\/campaign|\/pricing\/?$|\/download\/?$|^\/(?:en|zh|zh-cn|work|home)?$/iu;
const LOGO_URL_RE = /logo|favicon|icon|avatar|brand|sprite|og[-_]?image|opengraph|apple-touch|wordmark/iu;
const TRUSTED_LOCAL_UI_RE = /^\/generated\/ui\/(?:workbuddy-|trae-|qwen-|doubao-|microsoft-)/iu;

const KNOWN_APP_UI = [
  {
    keys: ["workbuddy"],
    screens: [
      {
        screen: "本地任务工作台", usageStage: "进入/发起", sourceType: "official_tutorial",
        sourceUrl: "https://www.workbuddy.cn/docs/workbuddy/Create-Task",
        imageFile: "workbuddy-official-task.png", pageKind: "home",
        purpose: "选择模式、模型、工作空间并发起独立任务",
        entry: "左侧新建任务", primaryAction: "设置模式与工作空间后输入任务",
        feedback: "任务进入左侧列表并维护独立上下文",
        friction: "模式、模型、技能和权限集中在输入区，新用户需要建立选择顺序",
        annotation: "1. 侧栏任务入口；2. 办公/代码模式；3. 输入与技能权限；4. 工作空间；5. 最佳实践卡片",
        callouts: [
          { n: 1, x: 8, y: 18, label: "侧栏：新建任务/助理/项目/专家/自动化", insight: "一级 IA 以任务对象为中心，而不是会话气泡" },
          { n: 2, x: 50, y: 20, label: "日常办公 / 代码开发", insight: "岗位域切换会改变后续工具、技能和权限边界" },
          { n: 3, x: 50, y: 46, label: "输入框与技能/权限", insight: "发起前就要选择能力和授权；Ask/Craft/Plan 放权在输入条模式菜单里" },
          { n: 4, x: 42, y: 58, label: "选择工作空间", insight: "文件范围是 Agent 执行边界" },
          { n: 5, x: 50, y: 84, label: "最佳实践案例", insight: "用岗位场景降低空白页冷启动" },
        ],
      },
      {
        screen: "工作空间设置", usageStage: "配置", sourceType: "official_tutorial",
        sourceUrl: "https://www.workbuddy.cn/docs/workbuddy/Create-Task",
        imageFile: "workbuddy-official-workspace.png",
        purpose: "限定 Agent 可读写的文件范围",
        entry: "新建任务输入区的工作空间入口", primaryAction: "选择任务专用目录",
        feedback: "后续生成文件优先写入选定空间",
        friction: "目录授权的持续时间和越界行为需要更直观说明",
        annotation: "1. 搜索工作空间；2. 新建空间；3. 打开本地空间；4. 当前选择工作空间",
        callouts: [
          { n: 1, x: 50, y: 22, label: "搜索工作空间", insight: "空间是可检索对象，不是一次性文件夹" },
          { n: 2, x: 50, y: 32, label: "从新工作空间开始", insight: "每个任务可隔离文件边界" },
          { n: 3, x: 50, y: 42, label: "打开本地工作空间", insight: "本地目录授权决定读写范围" },
          { n: 4, x: 50, y: 88, label: "选择工作空间入口", insight: "发起任务前必须确认执行目录" },
        ],
      },
      {
        screen: "权限模式确认", usageStage: "治理", sourceType: "official_tutorial",
        sourceUrl: "https://www.workbuddy.cn/docs/workbuddy/Create-Task",
        imageFile: "workbuddy-official-permission.png", pageKind: "function",
        purpose: "在执行效率与敏感操作确认之间做选择",
        entry: "任务输入区权限菜单", primaryAction: "选择默认权限或完全访问权限",
        feedback: "高风险模式明确提示可能涉及文件修改和外部执行",
        friction: "完全访问的风险较高，需要范围、期限与撤回入口",
        annotation: "1. 默认权限；2. 完全访问；3. 风险说明",
        callouts: [
          { n: 1, x: 62, y: 52, label: "默认权限", insight: "低风险默认减少确认打断" },
          { n: 2, x: 62, y: 40, label: "完全访问", insight: "高权限对应文件修改和外部执行" },
          { n: 3, x: 50, y: 62, label: "风险说明", insight: "治理信息必须出现在确认前" },
        ],
      },
      {
        screen: "任务执行与完成态", usageStage: "执行", sourceType: "actual_app_ui",
        sourceUrl: "https://www.workbuddy.cn/docs/workbuddy/Conversation",
        imageFile: "workbuddy-running-runoob.png", pageKind: "function",
        purpose: "在独立任务里跟踪执行并拿到文件产物",
        entry: "提交任务后进入该任务对话", primaryAction: "查看完成状态、耗时并打开产物文件",
        feedback: "显示已完成、耗时和可点击的文件胶囊",
        friction: "多步工具调用默认折叠，需要主动展开才能审计中间步骤",
        annotation: "1. 任务标题；2. 完成状态与耗时；3. 产物文件",
        callouts: [
          { n: 1, x: 22, y: 14, label: "任务标题", insight: "执行对象是独立任务，有名称而不是匿名会话" },
          { n: 2, x: 28, y: 36, label: "完成状态与耗时", insight: "长任务必须给出已完成/耗时，而不是只有流式文字" },
          { n: 3, x: 38, y: 48, label: "产物文件胶囊", insight: "交付物是可打开的文件对象，不是纯文本" },
        ],
      },
      {
        screen: "三栏结果预览", usageStage: "交付", sourceType: "actual_app_ui",
        sourceUrl: "https://www.workbuddy.cn/docs/workbuddy/Results",
        imageFile: "workbuddy-result-runoob.png", pageKind: "function",
        purpose: "在任务上下文旁直接验收生成结果",
        entry: "任务完成后打开结果区", primaryAction: "预览 HTML/文档并继续追问修改",
        feedback: "右侧预览窗与中间产物卡片同步",
        friction: "三栏信息密度高，需要先理解任务、产物、预览的分工",
        annotation: "1. 侧栏任务/空间；2. 对话与产物卡片；3. 结果预览区",
        callouts: [
          { n: 1, x: 8, y: 28, label: "侧栏任务/空间", insight: "执行中仍保持任务与空间对象" },
          { n: 2, x: 38, y: 48, label: "对话与产物卡片", insight: "中间栏负责任务上下文和文件变更" },
          { n: 3, x: 78, y: 48, label: "结果预览区", insight: "右侧直接验收 HTML/文档，而不是跳到外部下载页" },
        ],
      },
      {
        screen: "输入条模式：Ask / Plan", usageStage: "配置", sourceType: "secondary_walkthrough",
        sourceUrl: "https://www.uisdc.com/workbuddy-complete-guide",
        imageFile: "workbuddy-uisdc-assistant-settings.png", pageKind: "function",
        purpose: "在默认执行、先出计划、仅问答之间选择放权程度",
        entry: "主工作台输入条左侧「+」或模式菜单", primaryAction: "打开模式，切换计划或仅问答",
        feedback: "当前模式有一句说明：默认可高效执行并完成任务",
        friction: "岗位域（办公/代码/设计）和放权模式（Ask/Craft/Plan）叠在同一输入条，需要两步才选对",
        annotation: "1. 侧栏对象；2. 岗位域；3. 计划/仅问答；4. 工作空间与默认权限",
        callouts: [
          { n: 1, x: 10, y: 28, label: "侧栏：新建任务/助理/项目", insight: "一级对象仍是任务、助理、项目，不是会话气泡" },
          { n: 2, x: 50, y: 18, label: "日常办公 / 代码开发 / 设计创意", insight: "岗位域是第三种工作台分流，设计创意与办公、代码并列" },
          { n: 3, x: 48, y: 58, label: "模式：计划 / 仅问答", insight: "Ask 只看不改；Plan 先出计划再执行；关闭二者才是默认 Craft 动手" },
          { n: 4, x: 48, y: 84, label: "工作空间与默认权限", insight: "目录边界和权限确认挂在输入条下方，发起前可见" },
        ],
      },
      {
        screen: "系统设置", usageStage: "治理", sourceType: "secondary_walkthrough",
        sourceUrl: "https://www.uisdc.com/workbuddy-complete-guide",
        imageFile: "workbuddy-uisdc-taskbar.png", pageKind: "function",
        purpose: "在独立设置窗里管理语言、技能更新、模型、记忆和助理",
        entry: "头像或更多进入设置", primaryAction: "在左侧分组与右侧开关之间切换",
        feedback: "当前项高亮，右侧立即显示对应控件",
        friction: "智能体、模型、助理设置分属不同分组，远程遥控入口不在主工作台",
        annotation: "1. 设置分组；2. 助理设置；3. 显示语言；4. 技能自动更新",
        callouts: [
          { n: 1, x: 14, y: 28, label: "账户/系统/智能体/快捷键/记忆/模型", insight: "设置是 master-detail，不是塞进对话里的开关" },
          { n: 2, x: 14, y: 68, label: "助理设置", insight: "远程 IM 绑定在系统设置里，和新建任务工作台分开" },
          { n: 3, x: 72, y: 30, label: "显示语言", insight: "客户端语言是设置对象，有中英切换" },
          { n: 4, x: 78, y: 70, label: "技能自动更新", insight: "技能是可更新资产；手动改过的技能不会被覆盖" },
        ],
      },
      {
        screen: "助理与 Claw 工作目录", usageStage: "进入", sourceType: "secondary_walkthrough",
        sourceUrl: "https://www.uisdc.com/workbuddy-complete-guide",
        imageFile: "workbuddy-uisdc-remote.png", pageKind: "function",
        purpose: "人离开电脑时从助理通道下达任务，执行仍落在本机固定目录",
        entry: "侧栏助理", primaryAction: "点助理旁文件夹打开 Claw 目录，或进助理设置绑 IM",
        feedback: "助理高亮；本机文件窗定位到 Workbuddy/Claw",
        friction: "助理不能并行开多个任务，也不能清空上下文，不适合人在电脑前的日常干活",
        annotation: "1. 助理入口；2. 文件夹快捷入口；3. Claw 固定目录",
        callouts: [
          { n: 1, x: 12, y: 22, label: "助理（远程入口）", insight: "助理是遥控监控室，不是第二条任务列表" },
          { n: 2, x: 18, y: 22, label: "助理旁文件夹", insight: "工作目录入口贴在助理上，提示执行仍在本机" },
          { n: 3, x: 62, y: 52, label: "Claw 固定工作目录", insight: "远程任务写入固定 Claw 空间，不能像普通任务那样自选目录" },
        ],
      },
    ],
  },
  {
    keys: ["traework", "trae"],
    screens: [
      { screen: "Work / Code / Design 模式切换", usageStage: "进入", sourceType: "official_tutorial", sourceUrl: "https://docs.trae.cn/work_trae-work-web-and-desktop-quickstart", imageFile: "trae-modes.webp", purpose: "按任务类型选择工作模式", entry: "界面左上角模式切换", primaryAction: "选择 Work、Code 或 Design", feedback: "工作区与可用工具随模式变化", friction: "模式边界需要用户预先判断", annotation: "1. 模式入口；2. 任务列表；3. 主工作区", callouts: [{ n: 1, x: 14, y: 16, label: "Work/Code/Design", insight: "模式决定工具面板和任务对象" }, { n: 2, x: 14, y: 48, label: "任务列表", insight: "以项目/任务组织，而不是单次对话" }, { n: 3, x: 58, y: 48, label: "主工作区", insight: "执行和产物发生在同一工作台" }] },
      { screen: "项目内发起任务", usageStage: "发起", sourceType: "official_tutorial", sourceUrl: "https://docs.trae.cn/work_trae-work-web-and-desktop-quickstart", imageFile: "trae-task.webp", purpose: "提交带附件、技能和环境要求的任务", entry: "主界面对话输入框", primaryAction: "选择项目与运行环境后发送指令", feedback: "系统自动创建项目/任务并开始拆解", friction: "云端与本地环境能力不同", annotation: "1. 项目；2. 输入附件；3. 技能与环境；4. 发送", callouts: [{ n: 1, x: 18, y: 20, label: "项目上下文", insight: "任务挂在项目上而不是漂浮会话" }, { n: 2, x: 48, y: 72, label: "输入与附件", insight: "发起时就要带资料" }, { n: 3, x: 72, y: 72, label: "技能/环境", insight: "执行环境是任务配置的一部分" }] },
      { screen: "任务摘要与产物工具面板", usageStage: "执行/交付", sourceType: "official_tutorial", sourceUrl: "https://docs.trae.cn/work_trae-work-web-and-desktop-quickstart", imageFile: "trae-panel.webp", purpose: "追踪待办、参考信息并预览产物", entry: "右上角展开工具面板", primaryAction: "在任务摘要、浏览器、产物等页签切换", feedback: "待办状态、引用上下文与产物实时更新", friction: "多页签提升能力密度也增加定位成本", annotation: "1. Todos；2. 任务产物；3. 参考信息与预览", callouts: [{ n: 1, x: 78, y: 22, label: "Todos", insight: "执行计划可见" }, { n: 2, x: 78, y: 48, label: "产物页签", insight: "交付物从工作台直接验收" }, { n: 3, x: 78, y: 72, label: "参考/预览", insight: "来源与结果并排" }] },
    ],
  },
  {
    keys: ["qwenwork", "千问办公"],
    screens: [
      { screen: "桌面主工作台", usageStage: "进入", sourceType: "official_tutorial", sourceUrl: "https://qwenwork.cn/docs/getting-started/desktop-workflow", imageFile: "qwen-main.png", pageKind: "home", purpose: "集中进入新任务、扩展、定时任务与历史", entry: "登录后桌面主窗口", primaryAction: "从侧边栏点击新任务或历史任务", feedback: "右侧承载对话、任务监控与产物", friction: "功能入口较多，需区分扩展、频道和任务", annotation: "1. 新任务；2. 扩展；3. 定时任务；4. 选择工作目录", callouts: [{ n: 1, x: 10, y: 16, label: "新任务", insight: "主对象是任务不是聊天" }, { n: 2, x: 10, y: 28, label: "扩展", insight: "能力以插件方式挂到工作台" }, { n: 3, x: 10, y: 42, label: "定时任务", insight: "工作流可离开当前会话继续跑" }, { n: 4, x: 50, y: 72, label: "选择工作目录", insight: "文件范围出现在发起动作旁边" }] },
      { screen: "任务监控", usageStage: "执行", sourceType: "official_tutorial", sourceUrl: "https://qwenwork.cn/docs/getting-started/desktop-workflow", imageFile: "qwen-monitor.png", pageKind: "function", purpose: "理解 Agent 正在做什么并及时纠偏", entry: "提交任务后自动出现的右侧监控区", primaryAction: "查看计划、技能、MCP 与被操作文件", feedback: "对话阶段性回复与监控状态同步变化", friction: "信息密度大，需区分计划、工具和结果", annotation: "1. 任务计划；2. 技能/MCP；3. 文件操作", callouts: [{ n: 1, x: 48, y: 30, label: "任务计划", insight: "执行步骤对用户可见" }, { n: 2, x: 82, y: 28, label: "任务监控", insight: "右侧独立监控区，而不是只靠对话流" }, { n: 3, x: 82, y: 62, label: "技能/MCP", insight: "工具调用是可审计事件" }] },
      { screen: "产物收取与续改", usageStage: "交付", sourceType: "official_tutorial", sourceUrl: "https://qwenwork.cn/docs/getting-started/desktop-workflow", imageFile: "qwen-artifact.png", purpose: "下载可编辑文件并在原上下文继续迭代", entry: "任务完成后的产物卡片", primaryAction: "预览/下载产物或继续提出修改", feedback: "产物永久附着于任务，历史任务可再次打开", friction: "本地历史不跨设备同步", annotation: "1. 完成总结；2. 产物卡片；3. 继续修改", callouts: [{ n: 1, x: 48, y: 22, label: "完成总结", insight: "交付先给结论再给文件" }, { n: 2, x: 48, y: 52, label: "产物卡片", insight: "结果是可下载对象" }, { n: 3, x: 48, y: 78, label: "继续修改", insight: "同一任务上下文可迭代" }] },
    ],
  },
  {
    keys: ["doubaowork", "豆包工作"],
    screens: [
      {
        screen: "电脑版主工作台", usageStage: "进入/发起", sourceType: "secondary_walkthrough",
        sourceUrl: "https://www.uisdc.com/feishu-agent",
        imageFile: "doubao-uisdc-tabs.png", pageKind: "home",
        purpose: "用飞书企业身份进入任务台，并从侧栏分流到定时、技能和远控",
        entry: "飞书登录后的豆包工作电脑版", primaryAction: "点新工作任务或在输入框创建任务",
        feedback: "问候语 + 场景胶囊 + 底部输入条",
        friction: "技能、连接器、伙伴、企业知识同时出现在侧栏和输入条，边界要自己分",
        annotation: "1. 新工作任务；2. 定时任务；3. 技能入口；4. 手机遥控；5. 飞书企业身份；6. 输入条对象",
        callouts: [
          { n: 1, x: 12, y: 16, label: "新工作任务", insight: "主对象是工作任务，不是豆包 App 里的闲聊" },
          { n: 2, x: 12, y: 24, label: "定时任务", insight: "可离开当前对话持续跑" },
          { n: 3, x: 14, y: 34, label: "技能·连接器·伙伴", insight: "能力市场和任务入口分开" },
          { n: 4, x: 14, y: 58, label: "手机遥控电脑", insight: "移动端是控制面，电脑才是执行面" },
          { n: 5, x: 14, y: 92, label: "飞书企业与实名", insight: "左下角展示飞书组织，说明这是飞书原生身份而不是游客会话" },
          { n: 6, x: 52, y: 78, label: "工作任务 / 项目 / 企业知识 / 连接器", insight: "输入条把飞书知识与连接器做成发起控件" },
        ],
      },
      {
        screen: "飞书一键登录", usageStage: "进入", sourceType: "secondary_walkthrough",
        sourceUrl: "https://www.uisdc.com/feishu-agent",
        imageFile: "doubao-uisdc-login.png",
        purpose: "用飞书账号进入工作台并继承企业上下文",
        entry: "下载安装后或解锁更多功能时", primaryAction: "飞书账号一键登录或飞书/豆包 App 扫码",
        feedback: "登录后左下角出现企业名与真实姓名",
        friction: "同时提供豆包手机号和抖音登录，个人身份与企业身份可能被看混",
        annotation: "1. 飞书一键登录；2. 豆包手机号；3. 飞书/豆包扫码",
        callouts: [
          { n: 1, x: 28, y: 34, label: "飞书账号一键登录", insight: "主登录是飞书，不是把飞书当第三方插件" },
          { n: 2, x: 28, y: 48, label: "豆包手机号登录", insight: "个人豆包账号仍在，和企业飞书身份并列" },
          { n: 3, x: 74, y: 52, label: "豆包 / 飞书 App 扫码", insight: "扫码同时认两套客户端，强调原生打通" },
        ],
      },
      {
        screen: "技能与连接器市场", usageStage: "配置", sourceType: "secondary_walkthrough",
        sourceUrl: "https://www.uisdc.com/feishu-agent",
        imageFile: "doubao-uisdc-runmode.png",
        purpose: "把企微、钉钉、网盘、金融数据源装成可调用连接器",
        entry: "侧栏技能·连接器·伙伴", primaryAction: "搜索或点 + 安装连接器",
        feedback: "卡片带连接器标签，一点即可加入",
        friction: "精选里金融和法律源很多，办公协同与飞书能力混在同一宫格",
        annotation: "1. 当前模块；2. 搜索/我的技能/新建；3. 连接器卡片",
        callouts: [
          { n: 1, x: 12, y: 28, label: "技能·连接器·伙伴", insight: "能力扩展是独立一级模块" },
          { n: 2, x: 78, y: 10, label: "搜索 / 我的技能 / 新建", insight: "技能可检索、可沉淀、可对话创建" },
          { n: 3, x: 48, y: 48, label: "企微/钉钉/同花顺等连接器", insight: "连接器是外部系统适配器，不是聊天插件图标" },
        ],
      },
      {
        screen: "工作伙伴广场", usageStage: "配置", sourceType: "secondary_walkthrough",
        sourceUrl: "https://www.uisdc.com/feishu-agent",
        imageFile: "doubao-uisdc-connectors.png",
        purpose: "按岗位挑选预设伙伴，而不是只靠通用对话",
        entry: "技能页里的工作伙伴", primaryAction: "按行业筛选并添加伙伴",
        feedback: "伙伴卡片带人设、职责标签和加入按钮",
        friction: "伙伴与技能、连接器的差异要用户自己理解",
        annotation: "1. 工作伙伴；2. 行业筛选；3. 伙伴卡片",
        callouts: [
          { n: 1, x: 48, y: 8, label: "工作伙伴", insight: "伙伴是岗位人设，和 MCP 连接器不是同一层对象" },
          { n: 2, x: 42, y: 18, label: "内容/办公/研发等筛选", insight: "发现方式按岗位场景，而不是按 API 名" },
          { n: 3, x: 50, y: 48, label: "伙伴卡片与加入", insight: "能力以可加入的人设资产出现" },
        ],
      },
      {
        screen: "对话新建技能", usageStage: "配置", sourceType: "secondary_walkthrough",
        sourceUrl: "https://www.uisdc.com/doubao",
        imageFile: "doubao-skill-create.jpg",
        purpose: "把重复任务沉淀为自定义技能",
        entry: "技能页右上角新建菜单", primaryAction: "选择与豆包对话新建技能",
        feedback: "同时提供上传技能与自定义连接器路径",
        friction: "创建方式多，缺少适用条件提示",
        annotation: "1. 我的技能；2. 新建菜单；3. 对话创建",
        callouts: [
          { n: 1, x: 24, y: 30, label: "我的技能", insight: "能力可沉淀为资产" },
          { n: 2, x: 78, y: 16, label: "新建菜单", insight: "对话生成、上传、连接器分叉" },
          { n: 3, x: 60, y: 48, label: "对话新建技能", insight: "把一次任务变成可复用能力" },
        ],
      },
      {
        screen: "电脑版工作台（视频实机）", usageStage: "进入", sourceType: "video_walkthrough",
        sourceUrl: "https://www.bilibili.com/video/BV1TR8X63EYT/?t=86.637384",
        imageFile: "doubao-video-workbench.png",
        videoSeconds: 87, videoTimestamp: "1:27",
        purpose: "从实操视频核验定时任务、技能、连接器和云电脑同屏出现",
        entry: "B 站豆包工作功能讲解约 1:27", primaryAction: "对照侧栏模块与电脑版操作",
        feedback: "视频里出现应用内页面而不是口播",
        friction: "视频取帧清晰度低于文章截图，需与优设实机对照",
        annotation: "取帧 1:27，核验电脑版工作台模块",
        callouts: [
          { n: 1, x: 18, y: 30, label: "视频中的电脑版界面", insight: "官方文档不足时，实操视频是合法的应用内证据" },
        ],
      },
    ],
  },
  {
    keys: ["microsoft365copilot", "microsoftcopilot"],
    screens: [
      { screen: "Agent 零状态与提示起点", usageStage: "进入", sourceType: "official_tutorial", sourceUrl: "https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/ux-custom-engine-agent", imageFile: "microsoft-zero-prompts.png", pageKind: "home", purpose: "降低首次对话的空白页启动成本", entry: "Microsoft 365 Copilot 中打开某个 Agent", primaryAction: "选择提示起点或输入需求", feedback: "展示 Agent 身份、能力范围与可选起点", friction: "起点质量取决于预设提示是否贴合岗位任务", annotation: "1. Agent 身份；2. 提示起点；3. 输入框", callouts: [{ n: 1, x: 50, y: 10, label: "Agent 身份", insight: "先声明能力边界" }, { n: 2, x: 48, y: 42, label: "提示起点卡片", insight: "用场景降低空白页" }, { n: 3, x: 48, y: 88, label: "底部输入框", insight: "仍允许自由发起" }] },
      { screen: "流式执行反馈", usageStage: "执行", sourceType: "official_tutorial", sourceUrl: "https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/ux-custom-engine-agent", imageFile: "microsoft-streaming.png", purpose: "在长任务中持续获得进度感知", entry: "发送需要 Agent 处理的请求", primaryAction: "继续阅读、补充消息或等待完成", feedback: "响应逐步流式呈现，主线程不被长任务阻塞", friction: "流式文本不等于任务状态", annotation: "1. 流式状态；2. 对话连续性；3. 异步反馈", callouts: [{ n: 1, x: 50, y: 28, label: "流式生成", insight: "进度可见但不是任务对象" }, { n: 2, x: 50, y: 55, label: "对话连续性", insight: "主线程不被阻塞" }] },
      { screen: "答案引用与可追溯性", usageStage: "交付/治理", sourceType: "official_tutorial", sourceUrl: "https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/ux-custom-engine-agent", imageFile: "microsoft-citations.png", purpose: "核验答案依据并降低企业决策风险", entry: "Agent 返回含企业数据或外部知识的答案", primaryAction: "展开引用并回到原始来源", feedback: "答案附近显示可交互的引用标记", friction: "引用存在不代表结论正确", annotation: "1. 引用标记；2. 来源展开；3. AI 标签", callouts: [{ n: 1, x: 62, y: 30, label: "引用标记", insight: "结论必须能点回来源" }, { n: 2, x: 62, y: 58, label: "来源展开", insight: "企业采购看可追溯性" }, { n: 3, x: 18, y: 16, label: "AI 标签", insight: "生成内容需要标识" }] },
    ],
  },
];

export function looksLikeLogoUrl(value) {
  return LOGO_URL_RE.test(String(value || ""));
}

export function isTrustedLocalUi(value) {
  return TRUSTED_LOCAL_UI_RE.test(String(value || ""));
}

export function isMarketingSource(value) {
  const url = publicHttpUrl(value);
  if (!url) return false;
  if (isAffiliateLanding(url)) return true;
  const parsed = new URL(canonicalizeHarvestUrl(url));
  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  if (DOC_PAGE_RE.test(pathname) || /\/blog\/|\/article\/|\/posts\/|\/learn\//iu.test(pathname)) return false;
  if (MARKETING_PATH_RE.test(pathname)) return true;
  return /pricing|download|newsroom|press-release|careers|contact\/?$/u.test(pathname);
}

export function knownAppUiFor(name) {
  const compact = String(name || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/gu, "");
  if (!compact) return null;
  return KNOWN_APP_UI.find((item) => item.keys.some((key) => {
    if (key.length >= 6) return compact.includes(key) || (compact.length >= 6 && key.includes(compact));
    return compact === key || compact.startsWith(key) || compact.endsWith(key);
  })) || null;
}

function publicHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    const host = url.hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "::1"].includes(host) || host.endsWith(".local")) return "";
    if (/^(?:10|127|169\.254|192\.168)\./u.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./u.test(host)) return "";
    return url.href;
  } catch { return ""; }
}

export function isTutorialSource(value) {
  const url = publicHttpUrl(value);
  if (!url) return false;
  if (isAffiliateLanding(url)) return false;
  const parsed = new URL(canonicalizeHarvestUrl(url));
  const host = parsed.hostname.toLowerCase();
  const text = `${parsed.pathname}${parsed.search}`.toLowerCase();
  if (isOfficialKnowledgeHost(url) && DOC_PAGE_RE.test(parsed.pathname)) return true;
  if (/^(?:help|docs|support|learn|knowledge|developer)\./u.test(host)) return true;
  if (DOC_PAGE_RE.test(text)) return true;
  if (isMarketingSource(url)) return false;
  if (/pricing|download|newsroom|press-release|careers|contact\/?$/u.test(text) && !/docs|help|guide|tutorial/u.test(text)) return false;
  if (/docs|help|learn|guide|tutorial|quickstart|getting-started|article|blog|forum|support|manual|wiki|walkthrough|how-to|academy|community|workspace|console|dashboard|courses?/u.test(text)) return true;
  if (isSecondaryWalkthroughHost(url)) return true;
  return false;
}

export function isCommunityWalkthrough(value) {
  return isSecondaryWalkthroughHost(value);
}

export function isVideoSource(value) {
  const url = publicHttpUrl(value);
  if (!url) return false;
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  return /(?:^|\.)(?:youtube\.com|youtu\.be|bilibili\.com|b23\.tv)$/iu.test(host)
    || /\/video\/|\/watch(?:\/|\?|$)|\/play\//iu.test(parsed.pathname + parsed.search);
}

export function isUsefulDocLink(href, text = "") {
  return isDocsNavLink(href, text);
}

export function youtubeVideoId(value) {
  const url = publicHttpUrl(value);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (/(?:^|\.)youtu\.be$/iu.test(parsed.hostname)) return parsed.pathname.replace(/^\//, "").slice(0, 20);
    return parsed.searchParams.get("v") || "";
  } catch { return ""; }
}

function stageFromDocText(text) {
  const value = String(text || "");
  if (/结果|交付|产物|results/iu.test(value)) return { screen: value || "结果查看", usageStage: "交付" };
  if (/对话|conversation|执行|管理|monitor/iu.test(value)) return { screen: value || "任务执行", usageStage: "执行" };
  if (/权限|设置|admin|治理/iu.test(value)) return { screen: value || "权限与设置", usageStage: "治理" };
  if (/创建|发起|create|快速开始|quickstart/iu.test(value)) return { screen: value || "创建任务", usageStage: "发起" };
  return { screen: value || "工作台", usageStage: "进入" };
}

async function chromeExecutable() {
  for (const candidate of CHROME_PATHS) if (await fs.access(candidate).then(() => true).catch(() => false)) return candidate;
  throw new Error("未找到可用于提取应用界面证据的 Chrome 或 Edge");
}

function extensionFor(contentType, source) {
  if (/webp/iu.test(contentType) || /\.webp(?:$|\?)/iu.test(source)) return "webp";
  if (/gif/iu.test(contentType) || /\.gif(?:$|\?)/iu.test(source)) return "gif";
  if (/jpe?g/iu.test(contentType) || /\.jpe?g(?:$|\?)/iu.test(source)) return "jpg";
  return "png";
}

async function extractApplicationImages(page) {
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    for (const image of document.querySelectorAll("img")) {
      const real = image.getAttribute("data-original") || image.getAttribute("data-actualsrc") || image.getAttribute("data-src");
      if (real && /^https?:\/\//iu.test(real) && (!image.getAttribute("src") || /data:image|placeholder|zhimg\.com\/50\//iu.test(image.getAttribute("src") || ""))) {
        image.src = real;
      }
    }
    window.scrollTo(0, document.body.scrollHeight);
  }).catch(() => {});
  await page.waitForTimeout(900);
  const raw = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("article img, .Post-RichText img, .RichText img, figure img, img")];
    return nodes.map((image, index) => {
      const src = image.currentSrc || image.src || image.getAttribute("src") || image.getAttribute("data-original") || image.getAttribute("data-actualsrc") || image.getAttribute("data-src") || image.getAttribute("srcset")?.split(/[\s,]/)[0] || "";
      const alt = image.alt || image.title || "";
      const width = image.naturalWidth || image.width || 0;
      const height = image.naturalHeight || image.height || 0;
      const caption = image.closest("figure")?.querySelector("figcaption")?.textContent || "";
      const nearbyText = `${alt} ${caption}`.replace(/\s+/g, " ").trim().slice(0, 160);
      return { src, alt, width, height, nearbyText, index };
    });
  });
  const seen = new Set();
  return raw
    .map((item) => ({ ...item, ...scoreUiImageCandidate(item) }))
    .filter((item) => {
      if (!isLikelyAppUiImage(item) || !item.src || seen.has(item.src)) return false;
      seen.add(item.src);
      return true;
    })
    .sort((a, b) => b.score - a.score);
}

async function collectUsefulDocLinks(page) {
  const pageUrl = page.url();
  const raw = await page.evaluate((origin) => {
    const seen = new Set();
    const out = [];
    for (const anchor of document.querySelectorAll("a[href]")) {
      try {
        const url = new URL(anchor.href, location.href);
        const text = (anchor.textContent || "").replace(/\s+/g, " ").trim() || decodeURIComponent((url.hash || "").replace(/^#/, ""));
        if (seen.has(url.href)) continue;
        seen.add(url.href);
        out.push({ href: url.href, text: text.slice(0, 48), origin });
      } catch {
        // Ignore malformed anchors in third-party docs.
      }
    }
    return out.slice(0, 80);
  }, pageUrl);
  return raw.filter((item) => {
    if (!sameKnowledgeFamily(item.origin, item.href) && new URL(item.href).hostname !== new URL(item.origin).hostname) return false;
    if (canonicalizeHarvestUrl(item.href) === canonicalizeHarvestUrl(item.origin) && !new URL(item.href).hash) return false;
    return isDocsNavLink(item.href, item.text);
  }).slice(0, 40);
}

async function dismissBlockingOverlays(page) {
  await page.addStyleTag({
    content: ".Modal-wrapper,.signFlowModal,.Login-content,.OpenInAppButton,.AppBanner,.css-1ynzxqw{display:none!important}body{overflow:auto!important}",
  }).catch(() => {});
  const selectors = [
    'button:has-text("关闭")',
    'button:has-text("暂不登录")',
    'button:has-text("以后再说")',
    ".Modal-closeButton",
    '[aria-label="关闭"]',
    'button:has-text("跳过")',
    ".bili-mini-close-icon",
    ".bpx-player-ctrl-btn",
  ];
  for (const selector of selectors) {
    const closers = page.locator(selector);
    const count = await closers.count();
    for (let index = 0; index < Math.min(count, 2); index += 1) {
      await closers.nth(index).click({ timeout: 800 }).catch(() => {});
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(500);
}

async function saveRemoteImage(context, source, assetsRoot, publicPrefix, seed, referer = "") {
  const headers = {};
  if (referer) headers.referer = referer;
  else if (/zhimg\.com/iu.test(source)) headers.referer = "https://zhuanlan.zhihu.com/";
  const response = await context.request.get(source, { timeout: 20000, headers });
  if (!response.ok()) throw new Error(`图片下载失败（${response.status()}）`);
  const body = await response.body();
  if (body.length < 12000) throw new Error("图片内容过小，未达到应用界面证据标准");
  const fileName = `${crypto.createHash("sha256").update(`${seed}:${source}`).digest("hex").slice(0, 18)}.${extensionFor(response.headers()["content-type"] || "", source)}`;
  await fs.writeFile(path.join(assetsRoot, fileName), body);
  return `${publicPrefix}/${fileName}`;
}

async function captureArticleScreenshot(page, assetsRoot, publicPrefix, seed) {
  const fileName = `${crypto.createHash("sha256").update(`${seed}:article`).digest("hex").slice(0, 18)}.png`;
  const target = page.locator("article, main, .Post-RichText, .RichText, .vp-doc, .theme-doc-markdown, .doc-content, #content").first();
  if (await target.count()) {
    const box = await target.boundingBox();
    if (box && box.width >= 480 && box.height >= 280) {
      await target.screenshot({ path: path.join(assetsRoot, fileName), timeout: 8000 });
    } else {
      await page.screenshot({ path: path.join(assetsRoot, fileName) });
    }
  } else {
    await page.screenshot({ path: path.join(assetsRoot, fileName) });
  }
  const stat = await fs.stat(path.join(assetsRoot, fileName));
  if (stat.size < 18000) throw new Error("文档页截图过小，未达到应用界面证据标准");
  return `${publicPrefix}/${fileName}`;
}

async function captureVideoFrame(page, audit, assetsRoot, publicPrefix, seed) {
  await page.waitForTimeout(3500);
  const seconds = Math.max(1, Number(audit.videoSeconds) || parseVideoSeconds(audit.sourceUrl) || 15);
  const video = page.locator("video").first();
  if (await video.count()) {
    await video.evaluate(async (element, target) => {
      element.muted = true;
      element.currentTime = Math.min(target, Number.isFinite(element.duration) ? Math.max(0, element.duration - 1) : target);
      await new Promise((resolve) => { const done = () => resolve(); element.addEventListener("seeked", done, { once: true }); setTimeout(done, 2500); });
      element.pause();
    }, seconds).catch(() => {});
  }
  const player = page.locator("video, ytd-player, #player, .bpx-player-container, .bilibili-player-video-wrap").first();
  if (!await player.count()) throw new Error("视频播放器未加载，可能需要登录或人工取帧");
  const box = await player.boundingBox();
  if (!box || box.width < 640 || box.height < 320) throw new Error("视频画面尺寸不足，无法核验应用 UI");
  const fileName = `${crypto.createHash("sha256").update(`${seed}:${audit.sourceUrl}:${seconds}`).digest("hex").slice(0, 18)}.png`;
  await player.screenshot({ path: path.join(assetsRoot, fileName) });
  const stat = await fs.stat(path.join(assetsRoot, fileName));
  if (stat.size < 20000) throw new Error("视频帧近似空白，需更换时间点");
  audit.videoSeconds = seconds;
  if (!audit.videoTimestamp) audit.videoTimestamp = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return `${publicPrefix}/${fileName}`;
}

function pushUniqueAudit(audits, next) {
  if (!next.sourceUrl) return;
  if (audits.some((item) => item.sourceUrl === next.sourceUrl && item.screen === next.screen)) return;
  audits.push(next);
}

export function seedInterfaceAuditsFromEvidence(analysis) {
  const px = analysis.productExperience || (analysis.productExperience = {});
  const groups = Array.isArray(px.competitorAudits) ? px.competitorAudits : (px.competitorAudits = []);
  for (const evidence of analysis.evidence || []) {
    const url = publicHttpUrl(evidence.url);
    if (!isTutorialSource(url) && !isVideoSource(url)) continue;
    const group = groups.find((item) => namesLikelySame(item.competitorName, evidence.title) || namesLikelySame(item.competitorName, evidence.claim));
    if (!group) continue;
    const screens = Array.isArray(group.interfaceAudit) ? group.interfaceAudit : (group.interfaceAudit = []);
    const meta = stageFromDocText(evidence.title || evidence.claim);
    pushUniqueAudit(screens, {
      screen: meta.screen,
      usageStage: meta.usageStage,
      sourceType: isVideoSource(url) ? "video_walkthrough" : (isCommunityWalkthrough(url) ? "secondary_walkthrough" : "official_tutorial"),
      sourceUrl: url,
      imageUrl: "",
      purpose: evidence.claim || "文档中的应用界面",
      entry: "待验证",
      primaryAction: "待验证",
      feedback: "待验证",
      friction: "待验证",
      annotation: evidence.claim || evidence.title || "待标注",
      callouts: [],
      evidenceIds: evidence.id ? [evidence.id] : [],
    });
  }
  return analysis;
}

async function expandDocsAudits(page, productAudit) {
  const links = await collectUsefulDocLinks(page);
  const screens = Array.isArray(productAudit.interfaceAudit) ? productAudit.interfaceAudit : (productAudit.interfaceAudit = []);
  for (const link of links.slice(0, 5)) {
    const meta = stageFromDocText(link.text);
    pushUniqueAudit(screens, {
      screen: meta.screen,
      usageStage: meta.usageStage,
      sourceType: "official_tutorial",
      sourceUrl: link.href,
      imageUrl: "",
      purpose: `官方文档「${link.text}」中的应用界面`,
      entry: "文档侧栏",
      primaryAction: "按文档步骤操作",
      feedback: "待从截图核验",
      friction: "待从截图核验",
      annotation: `来自文档子页：${link.text}`,
      callouts: [],
      evidenceIds: [],
    });
  }
}

function applyKnownScreen(target, screen, imageUrl) {
  Object.assign(target, {
    screen: screen.screen || target.screen,
    usageStage: screen.usageStage,
    sourceType: screen.sourceType,
    sourceUrl: screen.sourceUrl,
    purpose: screen.purpose,
    entry: screen.entry,
    primaryAction: screen.primaryAction,
    feedback: screen.feedback,
    friction: screen.friction,
    annotation: screen.annotation,
    callouts: screen.callouts,
  });
  if (imageUrl) target.imageUrl = imageUrl;
  if (screen.videoSeconds || screen.videoTimestamp) {
    target.videoSeconds = screen.videoSeconds || 0;
    target.videoTimestamp = screen.videoTimestamp || "";
  }
  stampVideoTiming(target);
  return target;
}

async function seedKnownAppUi(productAudit, assetsRoot, publicPrefix) {
  const known = knownAppUiFor(productAudit.competitorName);
  const screens = Array.isArray(productAudit.interfaceAudit) ? productAudit.interfaceAudit : (productAudit.interfaceAudit = []);
  productAudit.interfaceAudit = screens.filter((item) => {
    if (isTrustedLocalUi(item.imageUrl)) return true;
    if (looksLikeLogoUrl(item.imageUrl)) return false;
    if (isLowQualityWalkthrough(item.sourceUrl)) return false;
    if (item.sourceUrl && isMarketingSource(item.sourceUrl) && !isTutorialSource(item.sourceUrl) && !isVideoSource(item.sourceUrl)) return false;
    return true;
  });
  if (!known) return;
  for (const screen of known.screens) {
    if (isLowQualityWalkthrough(screen.sourceUrl)) continue;
    const localPath = path.join(assetsRoot, screen.imageFile);
    const exists = await fs.access(localPath).then(() => true).catch(() => false);
    const imageUrl = exists ? `${publicPrefix}/${screen.imageFile}` : "";
    const existing = productAudit.interfaceAudit.find((item) => item.screen === screen.screen);
    if (existing) {
      applyKnownScreen(existing, screen, imageUrl);
      continue;
    }
    productAudit.interfaceAudit.push(applyKnownScreen({ evidenceIds: [] }, screen, imageUrl));
  }
}

function stampSeededVisualResearch(productAudit) {
  const audits = productAudit.interfaceAudit || [];
  const completed = audits.filter((item) => item.imageUrl && item.sourceType !== "unverified").length;
  productAudit.visualResearch = {
    status: completed ? "completed" : "not_started",
    capturedAt: new Date().toISOString(),
    sourceUrl: audits.find((item) => item.imageUrl)?.sourceUrl || "",
    message: completed
      ? `已核验 ${completed} 张实际使用流程界面。只保留应用内工作台/任务/结果截图；官网 Logo 和宣传页未计入。`
      : "待检索应用内工作台、任务执行或结果界面",
  };
}

export async function enrichVisualEvidence(analysis, { assetsRoot, publicPrefix = "/generated/ui", force = false } = {}) {
  const px = analysis.productExperience || (analysis.productExperience = {});
  const groups = Array.isArray(px.competitorAudits) ? px.competitorAudits : [];
  const used = new Set();
  px.competitorAudits = (analysis.competitors || []).map((competitor) => {
    let found = groups.findIndex((item, index) => !used.has(index) && item.competitorName === competitor.name);
    if (found < 0) found = groups.findIndex((item, index) => !used.has(index) && namesLikelySame(item.competitorName, competitor.name));
    if (found >= 0) {
      used.add(found);
      const matched = groups[found];
      return {
        ...matched,
        competitorName: competitor.name,
        role: competitor.role || matched.role,
        interfaceAudit: (matched.interfaceAudit || []).map((item) => ({ ...item })),
      };
    }
    return {
      competitorName: competitor.name,
      role: competitor.role,
      designLogic: [competitor.fiveLayers?.strategy, ...(competitor.fiveLayers?.structure || [])].filter(Boolean),
      interactionLogic: competitor.coreJourney || [],
      interfaceAudit: [],
    };
  });
  seedInterfaceAuditsFromEvidence(analysis);
  await fs.mkdir(assetsRoot, { recursive: true });
  for (const productAudit of px.competitorAudits) {
    await seedKnownAppUi(productAudit, assetsRoot, publicPrefix);
    seedKnownDocsMap(productAudit);
  }
  for (const productAudit of px.competitorAudits) {
    const screens = Array.isArray(productAudit.interfaceAudit) ? productAudit.interfaceAudit : [];
    const ready = screens.filter((item) => isTrustedLocalUi(item.imageUrl) || (item.imageUrl && item.sourceType !== "unverified" && !looksLikeLogoUrl(item.imageUrl)));
    const pendingVideo = screens.filter((item) => item.sourceType === "video_walkthrough" && isVideoSource(item.sourceUrl) && !item.imageUrl);
    if (ready.length >= 2) productAudit.interfaceAudit = [...ready, ...pendingVideo];
    stampSeededVisualResearch(productAudit);
  }
  const pendingCapture = px.competitorAudits.some((group) => (group.interfaceAudit || []).some((item) => {
    if (isTrustedLocalUi(item.imageUrl) && item.sourceType !== "unverified") return false;
    if (item.imageUrl && item.sourceType !== "unverified") return false;
    if (!force && item.sourceType === "video_walkthrough") return false;
    return true;
  }));
  console.warn(`[ui-capture] products=${px.competitorAudits.length} pending=${pendingCapture ? "yes" : "no"}`);
  if (!pendingCapture) {
    const focus = px.competitorAudits[0];
    if (focus) {
      px.interfaceAudit = (focus.interfaceAudit || []).map((item) => ({ ...item }));
      px.visualResearch = { ...(focus.visualResearch || {}) };
    }
    return analysis;
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: await chromeExecutable(), args: ["--disable-dev-shm-usage", "--disable-features=Translate"] });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      locale: "zh-CN",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      extraHTTPHeaders: { "Accept-Language": "zh-CN,zh;q=0.9" },
    });
    for (const productAudit of px.competitorAudits) {
      const audits = Array.isArray(productAudit.interfaceAudit) ? productAudit.interfaceAudit : (productAudit.interfaceAudit = []);
      const hub = audits.find((item) => isTutorialSource(item.sourceUrl) && !isCommunityWalkthrough(item.sourceUrl) && !isVideoSource(item.sourceUrl));
      if (hub?.sourceUrl) {
        const hubPage = await context.newPage();
        try {
          await hubPage.goto(publicHttpUrl(hub.sourceUrl), { waitUntil: "domcontentloaded", timeout: 22000 });
          await dismissBlockingOverlays(hubPage);
          await expandDocsAudits(hubPage, productAudit);
          attachExtractedDocsMap(productAudit, await extractDocsMapFromPage(hubPage));
        } catch {
          // Hub page may be blocked; continue with existing URLs.
        } finally { await hubPage.close().catch(() => {}); }
      }

      const sourceUseCount = new Map();
      let completed = 0;
      const failures = [];
      for (const audit of audits.slice(0, 12)) {
        if (isTrustedLocalUi(audit.imageUrl) && audit.sourceType !== "unverified") { completed += 1; continue; }
        if (!force && audit.imageUrl && audit.sourceType !== "unverified") { completed += 1; continue; }
        const sourceUrl = canonicalizeHarvestUrl(audit.sourceUrl) || publicHttpUrl(audit.sourceUrl);
        const videoSource = (audit.sourceType === "video_walkthrough" || isVideoSource(sourceUrl)) && isVideoSource(sourceUrl);
        const knowledgePage = isTutorialSource(sourceUrl) || isKnowledgeInnerUrl(sourceUrl, audit.screen);
        if (isLowQualityWalkthrough(sourceUrl) || isAffiliateLanding(sourceUrl)) {
          failures.push(`${audit.screen || "界面"}：来源是低质量或联盟落地页`);
          continue;
        }
        if (isMarketingSource(sourceUrl) && !videoSource && !knowledgePage) {
          failures.push(`${audit.screen || "界面"}：来源是官网宣传页，不是应用内界面`);
          continue;
        }
        if (!sourceUrl) { failures.push(`${audit.screen || "界面"}：缺少可打开的网页`); continue; }
        if (audit.sourceType === "unverified") {
          audit.sourceType = videoSource ? "video_walkthrough" : (knowledgePage ? (isCommunityWalkthrough(sourceUrl) ? "secondary_walkthrough" : "official_tutorial") : "web_keyword");
        }
        const page = await context.newPage();
        try {
          await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 22000 });
          await dismissBlockingOverlays(page);
          if (videoSource) {
            try {
              audit.imageUrl = await captureVideoFrame(page, audit, assetsRoot, publicPrefix, `${productAudit.competitorName}:${audit.screen}`);
            } catch (error) {
              const videoId = youtubeVideoId(sourceUrl);
              if (!videoId) throw error;
              try {
                audit.imageUrl = await saveRemoteImage(context, `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`, assetsRoot, publicPrefix, `${productAudit.competitorName}:${audit.screen}:thumb`);
              } catch {
                audit.imageUrl = await saveRemoteImage(context, `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`, assetsRoot, publicPrefix, `${productAudit.competitorName}:${audit.screen}:hq`);
              }
              audit.annotation = `${audit.annotation || ""} 视频取帧失败，暂用公开缩略图，需人工核验操作画面。`.trim();
            }
            completed += 1;
            continue;
          }
          if (publicHttpUrl(audit.imageUrl) && !audit.imageUrl.startsWith(publicPrefix) && !looksLikeLogoUrl(audit.imageUrl)) {
            try {
              audit.imageUrl = await saveRemoteImage(context, audit.imageUrl, assetsRoot, publicPrefix, `${productAudit.competitorName}:${audit.screen}`, sourceUrl);
              completed += 1;
              continue;
            } catch { /* fall through to page image extraction */ }
          }
          const candidates = (await extractApplicationImages(page)).filter((item) => !looksLikeLogoUrl(item.src));
          const used = sourceUseCount.get(sourceUrl) || 0;
          const candidate = candidates[used] || candidates[0];
          if (candidate && isLikelyAppUiImage(candidate)) {
            audit.imageUrl = await saveRemoteImage(context, candidate.src, assetsRoot, publicPrefix, `${productAudit.competitorName}:${audit.screen}`, sourceUrl);
            audit.imageSourceUrl = candidate.src;
            audit.uiImageScore = candidate.score;
          } else if (knowledgePage && !isMarketingSource(sourceUrl)) {
            audit.imageUrl = await captureArticleScreenshot(page, assetsRoot, publicPrefix, `${productAudit.competitorName}:${audit.screen}`);
            audit.annotation = `${audit.annotation || ""} ${isCommunityWalkthrough(sourceUrl) ? "实操文无独立截图，已保存正文区域画面。" : "文档页无独立截图，已保存正文区域画面。"}`.trim();
          } else {
            throw new Error("页内图片未通过应用 UI 判定，未下载");
          }
          if (isCommunityWalkthrough(sourceUrl)) audit.sourceType = "secondary_walkthrough";
          else if (knowledgePage && audit.sourceType !== "secondary_walkthrough" && audit.sourceType !== "web_keyword") audit.sourceType = "official_tutorial";
          else if (!knowledgePage && audit.sourceType !== "video_walkthrough") audit.sourceType = "web_keyword";
          sourceUseCount.set(sourceUrl, used + 1);
          completed += 1;
        } catch (error) {
          failures.push(`${audit.screen || "界面"}：${String(error.message || error).split("\n")[0]}`);
          if (force && audit.imageUrl?.startsWith(publicPrefix) && !isTrustedLocalUi(audit.imageUrl)) audit.imageUrl = "";
        } finally { await page.close().catch(() => {}); }
      }
      productAudit.visualResearch = {
        status: completed ? (failures.length ? "partial" : "completed") : "failed",
        capturedAt: new Date().toISOString(),
        sourceUrl: audits.find((item) => item.imageUrl)?.sourceUrl || audits.find((item) => item.sourceUrl)?.sourceUrl || "",
        message: completed
          ? `已核验 ${completed} 张实际使用流程界面${failures.length ? `；${failures.length} 屏待补` : ""}。只保留应用内工作台/任务/结果截图；官网 Logo 和宣传页未计入。`
          : `未发现应用内界面：${failures.join("；") || "请补充官方教程或可用实操来源"}`,
      };
    }
    await context.close();
  } catch (error) {
    for (const item of px.competitorAudits) {
      if ((item.interfaceAudit || []).some((audit) => audit.imageUrl && audit.sourceType !== "unverified")) {
        stampSeededVisualResearch(item);
        continue;
      }
      item.visualResearch = { status: "failed", capturedAt: new Date().toISOString(), sourceUrl: "", message: String(error.message || error).split("\n")[0] };
    }
  } finally { await browser?.close().catch(() => {}); }

  const ranked = [...px.competitorAudits].sort((left, right) => Number(right.visualResearch?.status === "completed") - Number(left.visualResearch?.status === "completed"));
  const focus = ranked[0] || px.competitorAudits[0];
  if (focus) {
    px.interfaceAudit = (focus.interfaceAudit || []).map((item) => ({ ...item }));
    const anySuccess = px.competitorAudits.some((item) => item.visualResearch?.status === "completed" || item.visualResearch?.status === "partial");
    px.visualResearch = anySuccess
      ? { ...(px.competitorAudits.find((item) => item.visualResearch?.status !== "failed")?.visualResearch || focus.visualResearch) }
      : { ...focus.visualResearch };
  }
  return analysis;
}
