import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { enrichVisualEvidence, isCommunityWalkthrough, isMarketingSource, isTutorialSource, isUsefulDocLink, isVideoSource, knownAppUiFor, youtubeVideoId } from "../server/visual-evidence.mjs";

test("accepts official docs, community walkthroughs and video hosts as UI sources", () => {
  assert.equal(isTutorialSource("https://help.autodesk.com/docs/acc/getting-started"), true);
  assert.equal(isTutorialSource("https://zhuanlan.zhihu.com/p/2072617646596608260"), true);
  assert.equal(isCommunityWalkthrough("https://zhuanlan.zhihu.com/p/2077078013783577732"), true);
  assert.equal(isCommunityWalkthrough("https://www.workbuddy.cn/docs/workbuddy/Overview"), false);
  assert.equal(isTutorialSource("https://sspai.com/post/12345"), true);
  assert.equal(isTutorialSource("https://construction.autodesk.com/pricing"), false);
  assert.equal(isTutorialSource("https://www.trae.cn/sem-work"), false);
  assert.equal(isMarketingSource("https://www.trae.cn/sem-work"), true);
  assert.equal(isMarketingSource("https://www.workbuddy.cn/docs/workbuddy/Create-Task"), false);
  assert.equal(isTutorialSource("https://www.workbuddy.cn/docs/workbuddy/Create-Task"), true);
  assert.equal(isVideoSource("https://www.youtube.com/watch?v=abcdefghijk"), true);
  assert.equal(isVideoSource("https://www.bilibili.com/video/BV1xx411c7mD"), true);
  assert.equal(youtubeVideoId("https://youtu.be/abcdefghijk"), "abcdefghijk");
  assert.equal(youtubeVideoId("https://www.youtube.com/watch?v=abcdefghijk"), "abcdefghijk");
});

test("maps each office agent to its own in-app UI catalog", () => {
  assert.equal(knownAppUiFor("腾讯 WorkBuddy")?.keys[0], "workbuddy");
  assert.equal(knownAppUiFor("Trae Work")?.keys[0], "traework");
  assert.equal(knownAppUiFor("QwenWork (千问办公)")?.keys[0], "qwenwork");
  assert.equal(knownAppUiFor("豆包工作 (Doubao Work)")?.keys[0], "doubaowork");
  assert.equal(knownAppUiFor("Microsoft 365 Copilot")?.keys[0], "microsoft365copilot");
  assert.notEqual(knownAppUiFor("腾讯 WorkBuddy"), knownAppUiFor("Trae Work"));
});

test("follows WorkBuddy-style docs sidebar pages instead of stopping at Overview", () => {
  assert.equal(isUsefulDocLink("https://www.workbuddy.cn/docs/workbuddy/Create-Task", "创建任务"), true);
  assert.equal(isUsefulDocLink("https://www.workbuddy.cn/docs/workbuddy/Results", "结果查看"), true);
  assert.equal(isUsefulDocLink("https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project", "项目"), true);
  assert.equal(isUsefulDocLink("https://qwenwork.cn/docs/desktop/settings", "系统设置"), true);
  assert.equal(isUsefulDocLink("https://www.workbuddy.cn/docs/workbuddy/Changelog", "更新日志"), false);
});

test("treats UISDC walkthroughs as UI sources and keeps Bilibili timestamps", async () => {
  const { parseVideoSeconds, isSecondaryWalkthroughHost, isLowQualityWalkthrough } = await import("../server/source-harvest.mjs");
  assert.equal(isCommunityWalkthrough("https://www.uisdc.com/workbuddy-complete-guide"), true);
  assert.equal(isCommunityWalkthrough("https://www.uisdc.com/feishu-agent"), true);
  assert.equal(isSecondaryWalkthroughHost("https://www.uisdc.com/doubao"), true);
  assert.equal(isLowQualityWalkthrough("https://bibigpt.co/zh/blog/posts/doubao-work-review-guide"), true);
  assert.equal(parseVideoSeconds("https://www.bilibili.com/video/BV1TR8X63EYT/?t=86.637384"), 87);
  const doubao = knownAppUiFor("豆包工作 (Doubao Work)");
  assert.ok(doubao.screens.every((item) => !/bibigpt/.test(item.sourceUrl)));
  assert.ok(doubao.screens.some((item) => /uisdc\.com\/feishu-agent/.test(item.sourceUrl)));
  assert.ok(doubao.screens.some((item) => item.sourceType === "video_walkthrough" && item.videoSeconds === 87));
  const workbuddy = knownAppUiFor("腾讯 WorkBuddy");
  assert.ok(workbuddy.screens.some((item) => /uisdc\.com\/workbuddy-complete-guide/.test(item.sourceUrl)));
});

test("attaches distinct in-app screenshots and numbered callouts per product", async () => {
  const analysis = {
    competitors: [
      { name: "腾讯 WorkBuddy", role: "本品" },
      { name: "Trae Work", role: "直接竞品" },
    ],
    productExperience: { competitorAudits: [] },
  };
  const result = await enrichVisualEvidence(analysis, { assetsRoot: path.resolve("public/generated/ui") });
  assert.deepEqual(result.productExperience.competitorAudits.map((item) => item.competitorName), ["腾讯 WorkBuddy", "Trae Work"]);
  const workbuddy = result.productExperience.competitorAudits[0].interfaceAudit[0];
  const trae = result.productExperience.competitorAudits[1].interfaceAudit[0];
  assert.equal(workbuddy.imageUrl, "/generated/ui/workbuddy-official-task.png");
  assert.match(trae.imageUrl, /\/generated\/ui\/trae-/);
  assert.notEqual(workbuddy.imageUrl, trae.imageUrl);
  assert.ok(workbuddy.callouts.length >= 3);
  assert.equal(workbuddy.callouts[0].x, 8);
  assert.ok(result.productExperience.competitorAudits[0].interfaceAudit.length >= 5);
  assert.ok(result.productExperience.competitorAudits[0].interfaceAudit.some((item) => item.imageUrl.includes("workbuddy-running")));
  assert.ok(result.productExperience.competitorAudits[0].interfaceAudit.some((item) => item.imageUrl.includes("workbuddy-result")));
  assert.ok(result.productExperience.competitorAudits[0].interfaceAudit.some((item) => item.screen.includes("Ask") || item.screen.includes("助理")));
  assert.ok(result.productExperience.competitorAudits[0].docsMap.platforms.some((item) => /电脑|移动|小程序/.test(item.name)));
  assert.equal(result.productExperience.competitorAudits[0].visualResearch.status, "completed");
});
