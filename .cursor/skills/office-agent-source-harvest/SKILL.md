---
name: office-agent-source-harvest
description: Harvest real in-app UI evidence, official docs function trees, learning-center courses, hash-anchor doc sections, third-party walkthroughs, and tutorial-video timestamps for any software competitor analysis. Use when researching Autodesk ACC, Boards, Construction Cloud, Glodon AECORE, Procore, WorkBuddy, Doubao, SaaS, 竞品 UI, help docs, 保姆级指南, or when official homepages lack screenshots.
---

# Product UI source harvest

The waterfall is **product-agnostic**. Office agents, Autodesk ACC/Boards, Glodon AECORE, Procore, BIM tools, and other SaaS hide real IA in docs sidebars, **hash sections on one HTML page**, learn/courses catalogs, developer consoles, platform/install tabs, third-party walkthroughs, and tutorial videos. Do not stop at marketing homepages or affiliate landings.

## Waterfall (stop when you have real screens)

1. **Web keyword search first** — `{产品} 界面/工作台/控制台 截图 screenshot UI` and `{产品} 教程 walkthrough 步骤`. Any domain is a candidate. Do not start with `site:` only.
2. **Open the page, then match images** — Keep only pictures that look like app chrome (sidebar, toolbar, dialog, workbench, console; landscape desktop or tall phone). Drop logo, KV, hero, QR, infographic. **Download only after a match.**
3. **Official knowledge hub** — `/docs/` `/help/` `/learn/` `/page/courses` `/view/` sidebar or course catalog, plus `#锚点` sections.
4. **Second hop** — `site:{hostname}` for 快速开始, courses, 开通. Autodesk family: help / learnacc / boards. Glodon: aecore.glodon.com/docs.
5. **Strip tracking** — `cjdata`/`AID`/`PID` landings are not UI.
6. **Third-party / video** if still no chrome. CN office: 优设/知乎; AEC: AU/YouTube. Keep `t=` seconds.

Never use bibigpt / tool-directory hydrology as UI source. Never use 优设/飞书 queries for Autodesk/广联达.

## Canonical examples

| Product | Docs / walkthrough pattern | Typical inner screens |
|---|---|---|
| Autodesk ACC | `help.autodesk.com` + [ACC Learn courses](https://learnacc.autodesk.com/page/courses) + AU/YouTube | project home, Docs folder tree, issue/RFI, mobile photo |
| Autodesk Boards | `boards.autodesk.com` after stripping affiliate query; then help/learn inner pages | pre-construction board canvas, not the CJ landing |
| 广联达 AECORE | [guide_1_preview.html#成为开发者](https://aecore.glodon.com/docs/aecore/guide_1_preview.html#%E6%88%90%E4%B8%BA%E5%BC%80%E5%8F%91%E8%80%85) sidebar + hash | 开通订阅、产品与服务网格、立即开通 |
| WorkBuddy | workbuddy.cn 功能说明 + [优设完整指南](https://www.uisdc.com/workbuddy-complete-guide) | 新建任务、Ask/Plan、助理+Claw、系统设置 |
| 豆包工作 | 无完整 docs 侧栏时用 [优设飞书文](https://www.uisdc.com/feishu-agent) + B 站取帧 | 飞书登录、电脑版侧栏、技能市场、手机遥控 |
| QwenWork | qwenwork.cn/docs 按 Web/Win/macOS/HarmonyOS 拆手册 | 工作台、任务监控、系统设置 |

## Query recipes

See [queries.md](queries.md). Swap the `site:` filter to the product's world — do not search `site:uisdc.com` for Autodesk ACC.

## What counts as UI evidence

Keep: workbench/project home, create/run, result/deliverable, settings/admin, developer console with product grid, mobile counterpart, login that shows identity (SSO, Autodesk ID, Feishu).

Drop: logo, KV, SEM, pricing, installer, affiliate query strings, infographic collages, a different product's UI.

Each kept screen needs `usageStage`, `sourceType`, `sourceUrl` (hash preserved), numbered `callouts` on **actual controls**.

## After harvest

Seed `docsMap` (platforms + modules) and compile 结构层/框架层/表现层 from those screens plus the function tree. Desktop vs mobile (or Web vs field app vs developer console) must appear in 结构层.
