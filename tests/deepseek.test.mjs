import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConnectionTestRequest,
  buildHarvestCompileRequest,
  buildJsonRepairRequest,
  buildResearchRequest,
  buildUiDiscoveryRequest,
  coerceJson,
  extractResponseText,
  extractSearchNotes,
  extractWebSearchActions,
  fetchWithRetry,
  friendlyNetworkError,
  harvestSearchItems,
  mergeBriefWithHarvest,
  normalizeHarvest,
  parseSseBlock,
  readDeepSeekEnvelope,
  responsesEndpoint,
} from "../server/deepseek.mjs";

test("builds a lightweight connection test request", () => {
  const request = buildConnectionTestRequest("deepseek-v4-flash");
  assert.equal(request.model, "deepseek-v4-flash");
  assert.equal(request.max_tokens, 16);
  assert.equal(request.stream, false);
  assert.match(request.messages[1].content, /OK/);
});

test("builds a compact DeepSeek web research request", () => {
  const request = buildResearchRequest({ meta: { product: "Example AI" }, competitors: [] });
  assert.equal(request.model, "deepseek-v4-flash");
  assert.deepEqual(request.tools, [{ type: "web_search" }]);
  assert.equal(request.tool_choice, "auto");
  assert.equal(request.stream, true);
  assert.equal(request.reasoning.effort, "low");
  assert.deepEqual(request.text.format, { type: "json_object" });
  assert.match(request.input, /Example AI/);
  assert.match(request.input, /不要写完整七层分析/);
  assert.match(request.instructions, /web_search/);
  assert.equal(responsesEndpoint("https://api.deepseek.com/"), "https://api.deepseek.com/responses");
});

test("builds a WorkBuddy-style UI discovery request", () => {
  const request = buildUiDiscoveryRequest({ competitors: [{ name: "Autodesk ACC" }, { name: "Procore" }] });
  assert.equal(request.tool_choice, "auto");
  assert.match(request.instructions, /workbuddy.cn\/docs\/workbuddy\/Overview/);
  assert.match(request.instructions, /zhuanlan.zhihu.com/);
  assert.match(request.instructions, /uisdc.com/);
  assert.match(request.input, /Autodesk ACC/);
  assert.match(request.input, /创建任务/);
});

test("extracts structured response text and search actions", () => {
  const envelope = {
    output: [
      { type: "web_search_call", id: "search-1", status: "completed", action: { type: "search", query: "Example AI pricing" } },
      { type: "message", content: [{ type: "output_text", text: "{\"ok\":true}" }] },
    ],
  };
  assert.equal(extractResponseText(envelope), '{"ok":true}');
  assert.deepEqual(extractWebSearchActions(envelope), [{ id: "search-1", status: "completed", action: { type: "search", query: "Example AI pricing" } }]);
});

test("compiles harvest JSON from completed web_search_call items without more searching", () => {
  const envelope = {
    output: [
      { type: "reasoning", content: [{ text: "keep searching" }] },
      { type: "web_search_call", id: "search-1", status: "completed", action: { type: "search", query: "Autodesk ACC help", url: "https://help.autodesk.com/acc" } },
      { type: "web_search_call", id: "search-2", status: "completed", action: { type: "open_page", url: "https://help.autodesk.com/docs" } },
    ],
  };
  assert.equal(harvestSearchItems(envelope).length, 2);
  assert.deepEqual(extractSearchNotes(envelope).urls, ["https://help.autodesk.com/acc", "https://help.autodesk.com/docs"]);
  const request = buildHarvestCompileRequest({ meta: { product: "Autodesk ACC" } }, envelope);
  assert.equal(request.tool_choice, "none");
  assert.equal(request.input.some((item) => item?.type === "web_search_call"), true);
  assert.match(request.instructions, /停止搜索/);
});

test("retries transient network failures", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("temporary"), { code: "ECONNRESET" });
    return { ok: true };
  };
  const result = await fetchWithRetry("https://example.test", {}, fetchImpl, 1);
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

test("turns local permission errors into actionable guidance", () => {
  const friendly = friendlyNetworkError(Object.assign(new Error("blocked"), { code: "EACCES" }));
  assert.equal(friendly.code, "NETWORK_PERMISSION_DENIED");
  assert.match(friendly.message, /权限/);
});

test("relabels Zhihu harvest URLs as secondary walkthroughs", () => {
  const harvest = normalizeHarvest({
    uiEvidence: [{
      productName: "WorkBuddy",
      screen: "个人工作台",
      sourceType: "official_tutorial",
      sourceUrl: "https://zhuanlan.zhihu.com/p/2077078013783577732",
      claim: "交叉岗位场景",
    }],
  });
  assert.equal(harvest.uiEvidence[0].sourceType, "secondary_walkthrough");
});

test("merges harvested competitors without dropping user-specified products", () => {
  const merged = mergeBriefWithHarvest(
    { competitors: [{ name: "Autodesk ACC", url: "https://construction.autodesk.com/", role: "本品" }], evidenceNotes: "内部备注" },
    normalizeHarvest({
      summary: "已核对官网",
      queries: ["Autodesk ACC pricing"],
      gaps: ["缺少公开报价"],
      competitors: [
        { name: "Procore", url: "https://www.procore.com/", role: "直接竞品" },
        { name: "autodesk acc", url: "https://construction.autodesk.com/", role: "本品", pricing: "待核实" },
      ],
      evidence: [{ id: "E01", title: "Autodesk ACC 官网", url: "https://construction.autodesk.com/", claim: "建设云平台" }],
      uiEvidence: [{ productName: "Autodesk ACC", screen: "项目工作台", usageStage: "进入", sourceType: "official_tutorial", sourceUrl: "https://help.autodesk.com/docs/start", imageUrl: "https://help.autodesk.com/img/workspace.png" }],
    }),
  );
  assert.equal(merged.autoResearch, false);
  assert.equal(merged.competitors[0].name, "Autodesk ACC");
  assert.equal(merged.competitors[0].role, "本品");
  assert.equal(merged.competitors.some((item) => item.name === "Procore"), true);
  assert.match(merged.evidenceNotes, /内部备注/);
  assert.match(merged.evidenceNotes, /construction.autodesk.com/);
  assert.match(merged.evidenceNotes, /项目工作台/);
  assert.match(merged.evidenceNotes, /workspace.png/);
});

test("recovers truncated or comma-damaged model JSON", () => {
  assert.deepEqual(coerceJson("```json\n{\"ok\":true,}\n```"), { ok: true });
  assert.deepEqual(coerceJson('{"items":["a","b"'), { items: ["a", "b"] });
  const recovered = coerceJson('{"insights":["one","two" "three"],"actions":["go"]}');
  assert.deepEqual(recovered.insights, ["one", "two"]);
  const request = buildJsonRepairRequest("deepseek-v4-flash", '{"ok":');
  assert.match(request.messages[1].content, /无法被 JSON.parse/);
  assert.equal(request.response_format.type, "json_object");
});

test("parses completed SSE envelopes from the Responses API", async () => {
  const parsed = parseSseBlock("event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"output_text\":\"{\\\"ok\\\":true}\"}}");
  assert.equal(parsed.event, "response.completed");
  assert.equal(parsed.data.response.output_text, '{"ok":true}');
  const body = [
    "event: response.created",
    "data: {\"type\":\"response.created\"}",
    "",
    "event: response.completed",
    "data: {\"type\":\"response.completed\",\"response\":{\"output_text\":\"{\\\"ok\\\":true}\",\"output\":[]}}",
    "",
  ].join("\n");
  const envelope = await readDeepSeekEnvelope({
    headers: { get: () => "text/event-stream" },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
  });
  assert.equal(envelope.output_text, '{"ok":true}');
});

test("keeps streamed output text when the Responses API ends incomplete", async () => {
  const body = [
    "event: response.output_text.delta",
    "data: {\"type\":\"response.output_text.delta\",\"delta\":\"{\\\"ok\\\"\"}",
    "",
    "event: response.output_text.delta",
    "data: {\"type\":\"response.output_text.delta\",\"delta\":\":true}\"}",
    "",
    "event: response.incomplete",
    "data: {\"type\":\"response.incomplete\",\"response\":{\"status\":\"incomplete\",\"output\":[]}}",
    "",
  ].join("\n");
  const envelope = await readDeepSeekEnvelope({
    headers: { get: () => "text/event-stream" },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
  });
  assert.equal(envelope.output_text, '{"ok":true}');
  assert.equal(extractResponseText(envelope), '{"ok":true}');
});
