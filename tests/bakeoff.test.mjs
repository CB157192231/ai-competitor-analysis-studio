import test from "node:test";
import assert from "node:assert/strict";
import {
  compileBakeoff,
  DEFAULT_GOLDEN_TASKS,
  formatRunCell,
  formatRunCellText,
  normalizeRun,
} from "../public/bakeoff.js";
import { buildAnalysisPrompt, DEMO_ANALYSIS, normalizeAnalysis } from "../server/analysis.mjs";

test("compileBakeoff starts from the five default golden tasks", () => {
  const bakeoff = compileBakeoff({
    competitors: [{ name: "甲" }, { name: "乙" }],
  });
  assert.equal(bakeoff.tasks.length, 5);
  assert.deepEqual(bakeoff.tasks.map((item) => item.id), DEFAULT_GOLDEN_TASKS.map((item) => item.id));
  assert.ok(bakeoff.tasks.every((task) => task.runs.every((run) => run.status === "not_run" && run.source === "unrun")));
  assert.equal(bakeoff.scorecard.ranTaskCount, 0);
  assert.equal(bakeoff.scorecard.unrunTaskCount, 5);
  assert.match(bakeoff.summary, /未跑/);
});

test("inferred or marketing claims do not become passed without a measured run", () => {
  const bakeoff = compileBakeoff({
    competitors: [{ name: "甲" }],
    bakeoff: {
      tasks: [{
        id: "T01",
        name: DEFAULT_GOLDEN_TASKS[0].name,
        runs: [
          { product: "甲", status: "passed", source: "inferred", notes: "官网显示具备此能力" },
        ],
      }],
    },
  });
  const run = bakeoff.tasks.find((item) => item.id === "T01").runs[0];
  assert.equal(run.status, "not_run");
  assert.equal(run.source, "unrun");
  assert.equal(formatRunCell(run).title, "未跑");
  assert.equal(formatRunCellText(run), "未跑");
  assert.equal(run.publicPath.channel, "none");
});

test("public walkthrough paths stay on the cell without becoming a pass", () => {
  const run = normalizeRun({
    status: "passed",
    source: "inferred",
    notes: "官网显示可以完成",
    publicPath: {
      channel: "official_tutorial",
      url: "https://docs.example.com/export-docx",
      stagesSeen: ["进入", "执行", "交付"],
      notes: "教程从上传文件讲到导出 Word",
    },
  }, "甲", "manual");
  assert.equal(run.status, "not_run");
  assert.equal(run.publicPath.channel, "official_tutorial");
  assert.equal(run.publicPath.url, "https://docs.example.com/export-docx");
  assert.match(formatRunCell(run).detail, /公开路径/);
  assert.match(formatRunCellText(run), /未跑｜公开路径/);
});

test("public path without a real URL is dropped", () => {
  const run = normalizeRun({
    status: "not_run",
    publicPath: { channel: "official_web", url: "not-a-url", stagesSeen: ["执行"] },
  }, "甲");
  assert.equal(run.publicPath.channel, "none");
});

test("UI evidence can attach a public path to the matching golden task", () => {
  const bakeoff = compileBakeoff({
    competitors: [{ name: "甲" }],
    productExperience: {
      competitorAudits: [{
        competitorName: "甲",
        interfaceAudit: [{
          screen: "导出 Word",
          usageStage: "交付",
          sourceType: "official_tutorial",
          sourceUrl: "https://help.example.com/export",
          purpose: "把本地文件整理成可编辑文档",
          annotation: "上传本地文件后导出 Word",
        }],
      }],
    },
  });
  const t01 = bakeoff.tasks.find((item) => item.id === "T01").runs[0];
  const t04 = bakeoff.tasks.find((item) => item.id === "T04").runs[0];
  assert.equal(t01.status, "not_run");
  assert.equal(t01.publicPath.channel, "official_tutorial");
  assert.equal(t01.publicPath.url, "https://help.example.com/export");
  assert.equal(t04.publicPath.channel, "none");
  assert.ok(bakeoff.scorecard.pathRunCount >= 1);
  assert.match(bakeoff.summary, /操作路径/);
});

test("measured source still stays unrun when notes are marketing claims without evidence", () => {
  const run = normalizeRun({
    status: "passed",
    source: "measured",
    notes: "功能清单支持该任务",
    evidenceIds: [],
  }, "甲", "manual");
  assert.equal(run.status, "not_run");
});

test("demo measured runs are preserved and not overwritten by marketing inference", () => {
  assert.ok(DEMO_ANALYSIS.bakeoff.tasks.length >= 5);
  assert.ok(DEMO_ANALYSIS.bakeoff.scorecard.ranTaskCount >= 1);
  const t02 = DEMO_ANALYSIS.bakeoff.tasks.find((item) => item.id === "T02");
  const atlas = t02.runs.find((item) => item.product === "Atlas AI");
  assert.equal(atlas.status, "passed");
  assert.equal(atlas.source, "measured");
  assert.equal(atlas.timeToValueMinutes, 22);
  const t01 = DEMO_ANALYSIS.bakeoff.tasks.find((item) => item.id === "T01").runs.find((item) => item.product === "Atlas AI");
  assert.equal(t01.status, "not_run");
  assert.equal(t01.publicPath.channel, "official_tutorial");
});

test("normalizeAnalysis always emits bakeoff and keeps unrun cells unrun", () => {
  const result = normalizeAnalysis({
    competitors: [{ name: "甲" }, { name: "乙" }],
    bakeoff: {
      tasks: [{
        id: "T04",
        name: DEFAULT_GOLDEN_TASKS[3].name,
        runs: [{ product: "甲", status: "passed", notes: "宣传称可以完成", source: "inferred" }],
      }],
    },
  });
  assert.ok(result.bakeoff.tasks.length >= 5);
  assert.equal(result.bakeoff.tasks.find((item) => item.id === "T04").runs[0].status, "not_run");
  assert.match(result.limitations.join("；"), /黄金任务|评测集|实测/);
});

test("user scenarios can add extra golden tasks up to eight", () => {
  const bakeoff = compileBakeoff({
    competitors: [{ name: "甲" }],
    userNeeds: {
      scenarios: [
        { name: "周报自动汇总", task: "把周报汇总成可编辑文档", outcome: "文档可打开并可继续改" },
        { name: "客户纪要回写 CRM", task: "把纪要写回 CRM", outcome: "CRM 里能看到本次纪要" },
        { name: "合同风险对照", task: "对照两份合同", outcome: "输出带页码的差异表" },
        { name: "超出上限的第四个场景", task: "不应进入评测集", outcome: "被截断" },
      ],
    },
  });
  assert.equal(bakeoff.tasks.length, 8);
  assert.ok(bakeoff.tasks.some((item) => item.name === "周报自动汇总"));
  assert.equal(bakeoff.tasks.some((item) => item.name === "超出上限的第四个场景"), false);
});

test("measured login-wall probes stay not_run after compileBakeoff", () => {
  const bakeoff = compileBakeoff({
    competitors: [{ name: "甲" }],
    bakeoff: {
      tasks: [{
        id: "T02",
        name: DEFAULT_GOLDEN_TASKS[1].name,
        runs: [{
          product: "甲",
          status: "not_run",
          source: "measured",
          notes: "已打开官方网页版，停在登录墙。未跑。",
          publicPath: { channel: "official_web", url: "https://example.com/app", stagesSeen: ["进入"], notes: "登录墙" },
        }],
      }],
    },
  });
  const run = bakeoff.tasks.find((item) => item.id === "T02").runs[0];
  assert.equal(run.status, "not_run");
  assert.equal(run.source, "measured");
  assert.match(run.notes, /登录墙/);
  assert.equal(formatRunCell(run).title, "未跑");
  assert.match(formatRunCell(run).detail, /登录墙/);
  assert.equal(bakeoff.scorecard.ranTaskCount, 0);
  assert.equal(bakeoff.scorecard.probedRunCount, 1);
});

test("analysis prompt requires a bakeoff scorecard and forbids inferred passes", () => {
  const prompt = buildAnalysisPrompt({ meta: { product: "Example" } });
  assert.match(prompt, /黄金任务|bakeoff/);
  assert.match(prompt, /not_run/);
  assert.match(prompt, /不要下载或安装/);
  assert.match(prompt, /公开路径/);
  assert.match(prompt, /publicPath/);
  assert.match(prompt, /网页版实测|不要编造网页实测/);
});
