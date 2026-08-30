import test from "node:test";
import assert from "node:assert/strict";
import { knownDocsFor, isDocsNavLink } from "../server/docs-map.mjs";
import { isMarketingSource, isTutorialSource, isUsefulDocLink } from "../server/visual-evidence.mjs";
import {
  buildHarvestQueries,
  canonicalizeHarvestUrl,
  harvestSearchBudget,
  isAffiliateLanding,
  isKnowledgeInnerUrl,
  isLikelyAppUiImage,
  scoreUiImageCandidate,
} from "../server/source-harvest.mjs";

const BOARDS_AFFILIATE = "https://boards.autodesk.com/pre-construction/?cjdata=MXxOfDB8WXww&AID=17211621&PID=9069228&SID=cba-eb5dda11-e000-4894-8a36-6add8f8b0461&cjevent=9be06c2ca3d911f1818b00b00a18b8f6&affname=9069228_17211621&mktvar002=afc_us_products";

test("strips affiliate tracking and rejects that landing as UI evidence", () => {
  assert.equal(isAffiliateLanding(BOARDS_AFFILIATE), true);
  assert.equal(canonicalizeHarvestUrl(BOARDS_AFFILIATE), "https://boards.autodesk.com/pre-construction/");
  assert.equal(isMarketingSource(BOARDS_AFFILIATE), true);
  assert.equal(isTutorialSource(BOARDS_AFFILIATE), false);
  assert.equal(isUsefulDocLink(BOARDS_AFFILIATE, "Pre-construction"), false);
  assert.equal(isKnowledgeInnerUrl("https://boards.autodesk.com/pre-construction/"), false);
});

test("accepts docs hash sections, ACC Learn courses, and Autodesk help inner pages", () => {
  assert.equal(isUsefulDocLink("https://aecore.glodon.com/docs/aecore/guide_1_preview.html#%E6%88%90%E4%B8%BA%E5%BC%80%E5%8F%91%E8%80%85", "成为开发者"), true);
  assert.equal(isDocsNavLink("https://aecore.glodon.com/docs/aecore/guide_1_preview.html#%E5%BC%80%E9%80%9A%E8%AE%A2%E9%98%85%E6%9C%8D%E5%8A%A1", "开通订阅服务"), true);
  assert.equal(isTutorialSource("https://learnacc.autodesk.com/page/courses"), true);
  assert.equal(isUsefulDocLink("https://learnacc.autodesk.com/page/courses", "Courses"), true);
  assert.equal(isTutorialSource("https://help.autodesk.com/view/DOCS/ENU/"), true);
  assert.equal(isTutorialSource("https://aecore.glodon.com/docs/aecore/guide_1_preview.html"), true);
});

test("scores screenshot-like frames as UI and rejects logos", () => {
  assert.equal(isLikelyAppUiImage({
    src: "https://cdn.example.com/workbench-screenshot.png",
    alt: "工作台界面",
    width: 1440,
    height: 900,
  }), true);
  assert.equal(scoreUiImageCandidate({
    src: "https://cdn.example.com/logo-icon.png",
    alt: "logo",
    width: 256,
    height: 256,
  }).accepted, false);
  assert.equal(scoreUiImageCandidate({
    src: "https://cdn.example.com/hero-banner.jpg",
    alt: "banner",
    width: 1920,
    height: 360,
  }).accepted, false);
});

test("seeds AEC docs maps and builds host-scoped harvest queries", () => {
  assert.ok(knownDocsFor("Autodesk ACC")?.platforms.some((item) => /Learn|Boards/.test(item.name)));
  assert.ok(knownDocsFor("广联达 AECORE")?.modules.some((item) => item.name === "成为开发者"));
  const queries = buildHarvestQueries("Autodesk Boards").join("\n");
  assert.match(queries, /截图 OR screenshot/);
  assert.match(queries, /site:boards\.autodesk\.com/);
  assert.match(queries, /learnacc\.autodesk\.com/);
  assert.equal(harvestSearchBudget(1) >= 12, true);
  assert.equal(harvestSearchBudget(5) >= 15, true);
});
