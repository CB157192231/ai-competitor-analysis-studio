# Search queries

Replace `{产品}` with the exact name (e.g. `Autodesk ACC`, `Autodesk Boards`, `广联达 AECORE`, `腾讯 WorkBuddy`).

## Always — keywords on the open web, then docs

```
{产品} 界面 OR 工作台 OR 控制台 截图 OR screenshot OR UI
{产品} 教程 OR walkthrough OR 使用指南 截图 OR 步骤
{产品} 文档 OR docs OR help OR learn OR 快速开始
```

Any host can be opened. After the page loads, keep an image only if it looks like app UI; then download.

Then, if you know the host:

```
site:{hostname} 快速开始 OR 新手入门 OR 课程 OR courses OR 开通 OR 功能
```

Keep `#成为开发者` / `#开通订阅服务` in the stored URL.

Strip `cjdata`, `AID`, `PID`, `cjevent`, `utm_*` before judging a hit. Example: `boards.autodesk.com/pre-construction/` is an entry host, not a screenshot.

## AEC / Autodesk / 广联达

```
Autodesk ACC OR "Autodesk Construction Cloud" site:help.autodesk.com
Autodesk ACC courses site:learnacc.autodesk.com
Autodesk Boards OR pre-construction site:boards.autodesk.com
"Autodesk Construction Cloud" walkthrough OR tutorial site:youtube.com
广联达 AECORE 成为开发者 OR 开通订阅 site:aecore.glodon.com
```

Do **not** use `site:uisdc.com` or 飞书 for ACC/Boards/AECORE.

## CN office agents

```
{产品} 功能说明 docs
{产品} 保姆级 OR 完整指南 site:uisdc.com
{产品} 工作台 教程 site:zhuanlan.zhihu.com
{产品} 实操 site:bilibili.com
```

For videos, keep the `t=` deep link where the in-app UI is visible.
