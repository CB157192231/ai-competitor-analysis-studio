import test from "node:test";
import assert from "node:assert/strict";
import { compileBakeoff, overlayBakeoffProbes } from "../public/bakeoff.js";
import {
  applyLiveWebBakeoff,
  classifyWebEntry,
  probeToRun,
  resolveWebEntry,
} from "../server/web-bakeoff.mjs";

test("classifyWebEntry treats login forms as login walls, not failures", () => {
  const html = `
    <h1>QwenWork</h1>
    <p>验证后即可体验</p>
    <button>登录</button>
    <label>手机号</label>
    <button>钉钉</button>
    <a>使用网页版</a>
  `;
  assert.equal(classifyWebEntry(html, { url: "https://qwenwork.cn/", status: 200 }).kind, "login_wall");
});

test("classifyWebEntry treats download CTAs as download_only", () => {
  const html = `
    <h1>豆包工作</h1>
    <button>立即下载</button>
    <a>下载客户端</a>
    <p>Windows</p>
    <p>macOS</p>
  `;
  assert.equal(classifyWebEntry(html, { url: "https://www.doubao.com/work", status: 200 }).kind, "download_only");
});

test("classifyWebEntry detects an open workbench input", () => {
  const html = `<form><textarea placeholder="输入任务"></textarea><button>发送</button></form>`;
  assert.equal(classifyWebEntry(html, { status: 200 }).kind, "workbench");
});

test("classifyWebEntry keeps fetch errors as error, not failed tasks", () => {
  assert.equal(classifyWebEntry("", { status: 0, error: "ERR_INVALID_RESPONSE" }).kind, "error");
  assert.equal(classifyWebEntry("ok", { status: 502 }).kind, "error");
});

test("resolveWebEntry uses the official web app catalog, not installers", () => {
  assert.equal(resolveWebEntry({ name: "QwenWork" }).url, "https://qwenwork.cn/");
  assert.equal(resolveWebEntry({ name: "WorkBuddy" }).url, "https://www.workbuddy.cn/app");
  assert.equal(resolveWebEntry({ name: "豆包工作" }).url, "https://www.doubao.com/work");
  assert.equal(resolveWebEntry({ name: "Trae" }).url, "https://www.trae.cn/");
  assert.equal(resolveWebEntry({ name: "Unknown SaaS", url: "https://example.com/app" }).url, "https://example.com/app");
  assert.equal(resolveWebEntry({ name: "No Url Product" }), null);
});

test("probeToRun never marks a login wall or download page as passed", () => {
  const login = probeToRun("QwenWork", { kind: "login_wall", reason: "需要登录" }, "https://qwenwork.cn/");
  assert.equal(login.status, "not_run");
  assert.equal(login.source, "measured");
  assert.match(login.notes, /登录墙/);
  assert.equal(login.publicPath.channel, "official_web");

  const download = probeToRun("豆包工作", { kind: "download_only" }, "https://www.doubao.com/work");
  assert.equal(download.status, "not_run");
  assert.match(download.notes, /下载/);
});

test("overlayBakeoffProbes writes measured not_run onto T02 only", () => {
  const analysis = {
    competitors: [{ name: "QwenWork" }, { name: "WorkBuddy" }],
    bakeoff: compileBakeoff({ competitors: [{ name: "QwenWork" }, { name: "WorkBuddy" }] }),
  };
  const next = overlayBakeoffProbes(analysis, [
    probeToRun("QwenWork", { kind: "login_wall", reason: "手机号登录" }, "https://qwenwork.cn/"),
  ]);
  const t02 = next.tasks.find((item) => item.id === "T02");
  const t01 = next.tasks.find((item) => item.id === "T01");
  const qwen = t02.runs.find((item) => item.product === "QwenWork");
  const buddy = t02.runs.find((item) => item.product === "WorkBuddy");
  assert.equal(qwen.source, "measured");
  assert.equal(qwen.status, "not_run");
  assert.equal(buddy.source, "unrun");
  assert.equal(t01.runs.find((item) => item.product === "QwenWork").source, "unrun");
  assert.equal(next.scorecard.ranTaskCount, 0);
  assert.equal(next.scorecard.probedRunCount, 1);
  assert.match(next.summary, /官方网页版入口/);
});

test("applyLiveWebBakeoff runs from mocked pages and skips demo mode", async () => {
  const pages = {
    "https://qwenwork.cn/": "<p>验证后即可体验</p><button>登录</button><label>手机号</label>",
    "https://www.workbuddy.cn/app": "<div id=root></div>",
    "https://www.workbuddy.cn/": "<button>微信登录</button><button>手机号登录</button><p>验证码</p>",
    "https://www.doubao.com/work": "<button>立即下载</button><a>下载客户端</a>",
  };
  const analysis = {
    competitors: [
      { name: "QwenWork" },
      { name: "WorkBuddy" },
      { name: "豆包工作" },
    ],
    research: { mode: "web_search" },
    bakeoff: compileBakeoff({
      competitors: [{ name: "QwenWork" }, { name: "WorkBuddy" }, { name: "豆包工作" }],
    }),
  };
  const result = await applyLiveWebBakeoff(analysis, {
    fetchHtml: async (url) => ({
      url,
      finalUrl: url,
      status: 200,
      html: pages[url] || "",
    }),
  });
  const t02 = result.bakeoff.tasks.find((item) => item.id === "T02");
  assert.equal(t02.runs.find((item) => item.product === "QwenWork").source, "measured");
  assert.equal(t02.runs.find((item) => item.product === "QwenWork").status, "not_run");
  assert.match(t02.runs.find((item) => item.product === "QwenWork").notes, /登录墙/);
  assert.match(t02.runs.find((item) => item.product === "豆包工作").notes, /下载/);
  assert.match(t02.runs.find((item) => item.product === "WorkBuddy").notes, /登录墙|前端壳/);
  assert.equal(result.research.webBakeoff.taskId, "T02");
  assert.equal(result.research.webBakeoff.probes.length, 3);
  assert.equal(t02.runs.every((item) => item.status === "not_run"), true);

  const demo = await applyLiveWebBakeoff({ ...analysis, research: { mode: "demo" } }, {
    fetchHtml: async () => {
      throw new Error("demo must not probe the network");
    },
  });
  assert.equal(demo.research.webBakeoff, undefined);
});
