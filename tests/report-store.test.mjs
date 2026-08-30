import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  localDateStamp,
  listReportProjects,
  readReportProject,
  reportFolderName,
  sanitizeReportTopic,
  saveReport,
} from "../server/report-store.mjs";

test("names report folders from the research topic and local date", () => {
  const date = new Date(2026, 7, 28, 10, 30, 0);
  assert.equal(localDateStamp(date), "260828");
  assert.equal(reportFolderName({ meta: { product: "办公平台 agent" } }, date), "办公平台agent260828");
});

test("lists saved project JSON files and loads them by opaque id", async () => {
  const reportsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "competitor-projects-"));
  try {
    await saveReport({
      analysis: { meta: { title: "办公 Agent 调研", product: "WorkBuddy", date: "2026-08-29" }, research: { status: "completed" }, competitors: [{ name: "A" }], evidence: [{ id: "E01" }] },
      extension: "json",
      data: JSON.stringify({ meta: { title: "办公 Agent 调研", product: "WorkBuddy", date: "2026-08-29" }, research: { status: "completed" }, competitors: [{ name: "A" }], evidence: [{ id: "E01" }] }),
      reportsRoot,
      date: new Date(2026, 7, 29),
    });
    const projects = await listReportProjects(reportsRoot);
    assert.equal(projects.length, 1);
    assert.equal(projects[0].product, "WorkBuddy");
    assert.equal(projects[0].competitors, 1);
    const loaded = await readReportProject(reportsRoot, projects[0].id);
    assert.equal(loaded.analysis.meta.title, "办公 Agent 调研");
    await assert.rejects(() => readReportProject(reportsRoot, Buffer.from("../outside.json").toString("base64url")), /超出报告目录/);
  } finally {
    await fs.rm(reportsRoot, { recursive: true, force: true });
  }
});

test("sanitizes Windows path characters and reserved names", () => {
  assert.equal(sanitizeReportTopic('AI:办公/平台?*'), "AI-办公-平台");
  assert.equal(sanitizeReportTopic("CON"), "调研-CON");
});

test("saves report files inside the managed topic folder", async () => {
  const reportsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "competitor-reports-"));
  try {
    const saved = await saveReport({
      analysis: { meta: { product: "办公平台agent" } },
      extension: "json",
      data: "{\"ok\":true}\n",
      reportsRoot,
      date: new Date(2026, 7, 28),
    });
    assert.equal(path.basename(saved.folderPath), "办公平台agent260828");
    assert.equal(saved.fileName, "办公平台agent_竞品分析项目.json");
    assert.equal(await fs.readFile(saved.savedPath, "utf8"), "{\"ok\":true}\n");
  } finally {
    await fs.rm(reportsRoot, { recursive: true, force: true });
  }
});
