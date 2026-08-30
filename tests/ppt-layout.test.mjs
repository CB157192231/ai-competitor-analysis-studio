import test from "node:test";
import assert from "node:assert/strict";
import { fitPptNumberedList, fitPptText } from "../server/office.mjs";

test("fits long Chinese copy inside a fixed PPT box without going below 16px", () => {
  const result = fitPptText(
    "企业版团队协作与 Agent 平台化需要同时覆盖权限治理、任务审计、专有云部署、失败恢复、模型路由与单位任务成本核算，并确保长任务可以稳定完成。".repeat(4),
    { left: 0, top: 0, width: 260, height: 150 },
    { fontSize: 24, minFontSize: 16, lineSpacing: 1.12 },
  );

  assert.ok(result.fontSize >= 16);
  assert.ok(result.estimatedLines <= result.maxLines);
  assert.equal(result.truncated, true);
  assert.match(result.text, /…$/);
});

test("keeps complete Chinese sentences when ellipsis is disabled", () => {
  const feedback = "任务进入左侧列表并维护独立上下文";
  const fitted = fitPptText(feedback, { left: 0, top: 0, width: 216, height: 30 }, {
    fontSize: 14, minFontSize: 13, maxLines: 2, ellipsis: false,
  });
  assert.equal(fitted.text, feedback);
  assert.equal(fitted.truncated, false);

  const friction = "模式、模型、技能和权限集中在输入区，新用户需要建立选择顺序";
  const long = fitPptText(friction, { left: 0, top: 0, width: 228, height: 54 }, {
    fontSize: 13, minFontSize: 12, maxLines: 3, ellipsis: false, lineSpacing: 1.08,
  });
  assert.equal(long.text, friction);
  assert.equal(long.truncated, false);
});

test("fits numbered lists, strips duplicate ordinals, and preserves every visible item", () => {
  const items = [
    "1. 立即锁定企业版 GA 与行业解决方案，覆盖政企、制造和互联网团队",
    "2. 建立办公任务评测集与失败案例回流管道，把任务成功率作为核心指标",
    "3. 上线多模型路由与积分成本看板，建立单位任务成本护栏",
    "4. 补齐微信小程序与 IM 远程派活，拉高任务频次和分享裂变",
  ];
  const result = fitPptNumberedList(items, { left: 0, top: 0, width: 300, height: 190 }, {
    fontSize: 21,
    minFontSize: 16,
    maxItems: 4,
    lineSpacing: 1.12,
  });

  assert.ok(result.fontSize >= 16);
  assert.ok(result.estimatedLines <= result.maxLines);
  assert.match(result.text, /^01\s{2}(?!1\.)/);
  assert.match(result.text, /02\s{2}/);
  assert.match(result.text, /03\s{2}/);
  assert.match(result.text, /04\s{2}/);
});
