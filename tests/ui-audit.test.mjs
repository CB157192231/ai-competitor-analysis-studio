import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { compileUiAuditFromScreens, playbookFor } from "../public/ui-audit.js";
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
