import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { buildTaskChainComparison, compileUiAuditFromScreens, playbookFor } from "../public/ui-audit.js";
import { enrichVisualEvidence } from "../server/visual-evidence.mjs";

test("playbooks distinguish office agents", () => {
  assert.equal(playbookFor("腾讯 WorkBuddy")?.keys[0], "workbuddy");
  assert.equal(playbookFor("Trae Work")?.keys[0], "traework");
  assert.notEqual(playbookFor("腾讯 WorkBuddy")?.designFocus, playbookFor("Trae Work")?.designFocus);
});

test("does not invent five layers without evidenced screens", () => {
  const result = compileUiAuditFromScreens({
    competitors: [{ name: "腾讯 WorkBuddy", role: "本品", fiveLayers: { strategy: "待验证", scope: [], structure: [], framework: [], surface: [] } }],
    productExperience: {
      competitorAudits: [{
        competitorName: "腾讯 WorkBuddy",
        role: "本品",
        interfaceAudit: [{ screen: "官网", usageStage: "进入", sourceType: "unverified", imageUrl: "", callouts: [] }],
      }],
    },
  });
  assert.deepEqual(result.competitors[0].fiveLayers.structure, []);
  assert.deepEqual(result.competitors[0].fiveLayers.framework, []);
  assert.deepEqual(result.competitors[0].fiveLayers.surface, []);
});

test("compiles structure, framework and surface from WorkBuddy screens", () => {
  const result = compileUiAuditFromScreens({
    competitors: [{
      name: "腾讯 WorkBuddy",
      role: "本品",
      fiveLayers: { strategy: "待验证", scope: [], structure: [], framework: [], surface: [] },
    }],
    productExperience: {
      competitorAudits: [{
        competitorName: "腾讯 WorkBuddy",
        role: "本品",
        interfaceAudit: [{
          screen: "本地任务工作台",
          usageStage: "进入/发起",
          sourceType: "official_tutorial",
          imageUrl: "/generated/ui/workbuddy-official-task.png",
          entry: "左侧新建任务",
          primaryAction: "设置模式与工作空间后输入任务",
          feedback: "任务进入左侧列表",
          callouts: [
            { n: 1, x: 8, y: 18, label: "侧栏：新建任务/助理/项目/专家/自动化", insight: "一级 IA 以任务对象为中心，而不是会话气泡" },
            { n: 2, x: 50, y: 20, label: "日常办公 / 代码开发", insight: "工作模式决定后续工具、技能和权限边界" },
          ],
        }],
      }],
    },
  });
  const layers = result.competitors[0].fiveLayers;
  assert.ok(layers.structure.length >= 2);
  assert.ok(layers.framework.length >= 2);
  assert.ok(layers.surface.length >= 1);
  assert.equal(layers.structure.some((item) => /待验证/.test(item)), false);
  assert.match(layers.structure.join(" "), /任务/);
  assert.match(layers.framework.join(" "), /输入|导航|模式/);
  assert.ok(result.productExperience.competitorAudits[0].swimlanes.length >= 1);
  assert.ok(result.productExperience.swimlanes.length >= 1);
});

test("products keep distinct swimlanes compiled from their own screens", async () => {
  const seeded = await enrichVisualEvidence({
    competitors: [
      { name: "腾讯 WorkBuddy", role: "本品", fiveLayers: { strategy: "待验证", scope: [], structure: [], framework: [], surface: [] } },
      { name: "Trae Work", role: "直接竞品", fiveLayers: { strategy: "待验证", scope: [], structure: [], framework: [], surface: [] } },
    ],
    productExperience: { competitorAudits: [] },
  }, { assetsRoot: path.resolve("public/generated/ui") });
  const result = compileUiAuditFromScreens(seeded);
  const workbuddy = result.competitors[0].fiveLayers;
  const trae = result.competitors[1].fiveLayers;
  assert.ok(workbuddy.structure.length >= 2);
  assert.ok(trae.structure.length >= 2);
  assert.notEqual(workbuddy.structure[0], trae.structure[0]);
  assert.notEqual(workbuddy.framework.join(" "), trae.framework.join(" "));
  const workbuddyLanes = result.productExperience.competitorAudits[0].swimlanes.map((item) => item.stage).join(",");
  const traeLanes = result.productExperience.competitorAudits[1].swimlanes.map((item) => item.stage).join(",");
  assert.match(workbuddy.structure.join(" "), /电脑|助理|Ask|Plan|覆盖端/);
  const seededDoubao = await enrichVisualEvidence({
    competitors: [{ name: "豆包工作", role: "直接竞品", fiveLayers: { strategy: "待验证", scope: [], structure: [], framework: [], surface: [] } }],
    productExperience: { competitorAudits: [] },
  }, { assetsRoot: path.resolve("public/generated/ui") });
  const doubao = compileUiAuditFromScreens(seededDoubao).competitors[0].fiveLayers;
  assert.match(doubao.structure.join(" "), /飞书|电脑|手机/);
  assert.equal(seededDoubao.productExperience.competitorAudits[0].interfaceAudit.some((item) => /bibigpt/.test(item.sourceUrl || "")), false);
  assert.notEqual(result.productExperience.competitorAudits[0].designFocus, result.productExperience.competitorAudits[1].designFocus);
  assert.equal(result.productExperience.competitorAudits[0].interfaceAudit[0].callouts[0].x, 8);
  assert.equal(traeLanes.includes("进入"), true);
});

test("scores scenario value and onboarding cost in plain language", async () => {
  const seeded = await enrichVisualEvidence({
    competitors: [
      { name: "腾讯 WorkBuddy", role: "本品", fiveLayers: { strategy: "待验证", scope: [], structure: [], framework: [], surface: [] } },
      { name: "QwenWork（千问办公）", role: "直接竞品", fiveLayers: { strategy: "待验证", scope: [], structure: [], framework: [], surface: [] } },
      { name: "豆包工作（Doubao Work）", role: "直接竞品", fiveLayers: { strategy: "待验证", scope: [], structure: [], framework: [], surface: [] } },
    ],
    productExperience: { competitorAudits: [] },
  }, { assetsRoot: path.resolve("public/generated/ui") });
  const audits = compileUiAuditFromScreens(seeded).productExperience.competitorAudits;
  assert.equal(audits.every((item) => item.scenarioValue.scenarios.length >= 3), true);
  assert.equal(audits.every((item) => item.usabilityScore.dimensions.length === 6), true);
  assert.equal(audits.every((item) => item.usabilityScore.total >= 1 && item.usabilityScore.total <= 5), true);
  assert.equal(new Set(audits.map((item) => item.scenarioValue.bestScene)).size, 3);
  assert.equal(audits.some((item) => /交互侧重点|信息架构较好/u.test(item.usabilityScore.verdict)), false);
  assert.match(audits[0].usabilityScore.scale, /更容易上手/);
});

test("task-chain comparison uses observable UI evidence instead of repeating product positioning", () => {
  const comparison = buildTaskChainComparison([{
    competitorName: "产品 A",
    designFocus: "一句定位",
    weaknesses: ["中断后续跑入口不清晰"],
    interfaceAudit: [
      { screen: "任务首页", usageStage: "进入/发起", sourceType: "official_tutorial", imageUrl: "/a.png", entry: "点击新建任务", purpose: "创建独立任务", primaryAction: "选择工作空间并提交", feedback: "任务进入列表", friction: "模式较多" },
      { screen: "执行页", usageStage: "执行", sourceType: "actual_app_ui", imageUrl: "/b.png", primaryAction: "查看计划并停止任务", feedback: "逐步显示运行状态", friction: "失败原因折叠" },
      { screen: "结果页", usageStage: "交付", sourceType: "official_tutorial", imageUrl: "/c.png", primaryAction: "预览并下载", feedback: "产物卡片可续改", friction: "版本差异不明显" },
      { screen: "权限页", usageStage: "治理", sourceType: "official_tutorial", imageUrl: "/d.png", primaryAction: "确认读写范围", feedback: "显示当前授权", friction: "高权限风险说明较弱" },
    ],
  }]);
  assert.deepEqual(comparison.dimensions, ["入口对象", "发起与配置", "执行反馈", "失败恢复", "结果交付", "权限治理"]);
  assert.equal(comparison.cells.length, 6);
  assert.equal(new Set(comparison.cells.map((cell) => cell.focus)).size, 6);
  assert.equal(comparison.cells.some((cell) => cell.focus === "一句定位" || cell.focus === "交互侧重点"), false);
  assert.match(comparison.cells.find((cell) => cell.dimension === "执行反馈").focus, /运行状态/);
  assert.match(comparison.cells.find((cell) => cell.dimension === "结果交付").note, /结果页/);
});
