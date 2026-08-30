import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import {
  Presentation,
  PresentationFile,
} from "@oai/artifact-tool";
import { formatRunCell, formatRunCellText } from "../public/bakeoff.js";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  PageBreak,
  PageNumber,
  Paragraph,
  Packer,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { DIMENSIONS, normalizeAnalysis } from "./analysis.mjs";

const C = {
  ink: "#11231F",
  muted: "#5C6F68",
  accent: "#FF6B35",
  mint: "#2E8B77",
  lime: "#B7E36A",
  paper: "#F5F3EC",
  white: "#FFFFFF",
  line: "#D9DED8",
  warning: "#D9992B",
  red: "#D45D5D",
  blue: "#4978A8",
};

const PPT_W = 1280;
const PPT_H = 720;
const PPT_FONT = "Microsoft YaHei";
const pptTruncate = (value, max = 86) => {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const stripOrdinal = (value) => String(value || "")
  .replace(/^\s*(?:\d{1,2}\s*[.、):：-]\s*|[（(]?\d{1,2}[）)]\s*)/, "")
  .replace(/[。；;]+\s*$/u, "")
  .trim();

function textUnits(value) {
  let units = 0;
  for (const char of String(value || "")) {
    if (/\s/.test(char)) units += 0.3;
    else if (/[\u2e80-\u9fff\uf900-\ufaff\uff01-\uff60]/u.test(char)) units += 1;
    else if (/[A-Z0-9]/.test(char)) units += 0.62;
    else units += 0.52;
  }
  return units;
}

function truncateByUnits(value, maxUnits) {
  const text = String(value || "").trim();
  if (textUnits(text) <= maxUnits) return text;
  let result = "";
  for (const char of text) {
    if (textUnits(`${result}${char}…`) > maxUnits) break;
    result += char;
  }
  return `${result.trimEnd().replace(/[，。；：、,.!?！？;:]+$/u, "")}…`;
}

function conciseVisible(value, maxUnits = 42, fallback = "待验证") {
  const text = String(value || "")
    .replace(/(?:\.{3}|…+)\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return fallback;
  if (textUnits(text) <= maxUnits) return text;

  const clauses = text.split(/[。；\n]+/u).map((item) => item.trim()).filter(Boolean);
  let summary = "";
  for (const clause of clauses) {
    const candidate = summary ? `${summary}；${clause}` : clause;
    if (textUnits(candidate) > maxUnits) break;
    summary = candidate;
  }
  if (summary) return summary.replace(/[，、：:；;]+$/u, "");

  let prefix = "";
  for (const char of text) {
    if (textUnits(`${prefix}${char}`) > maxUnits) break;
    prefix += char;
  }
  const boundary = Math.max(prefix.lastIndexOf("，"), prefix.lastIndexOf("、"), prefix.lastIndexOf(" "));
  if (boundary >= Math.floor(prefix.length * 0.65)) prefix = prefix.slice(0, boundary);
  return prefix.trim().replace(/[，、：:；;。.!！?？]+$/u, "") || fallback;
}

function pptTextMetrics(value, position, fontSize, options = {}) {
  const insets = options.insets || { top: 0, right: 0, bottom: 0, left: 0 };
  const usableWidth = Math.max(1, position.width - (insets.left || 0) - (insets.right || 0));
  const usableHeight = Math.max(1, position.height - (insets.top || 0) - (insets.bottom || 0));
  const lineSpacing = options.lineSpacing || 1.18;
  const widthSafety = options.widthSafety || 1.08;
  const heightSafety = Math.max(lineSpacing, options.heightSafety || 1.28);
  const unitsPerLine = Math.max(1, usableWidth / (fontSize * widthSafety));
  const maxLinesByHeight = Math.max(1, Math.floor(usableHeight / (fontSize * heightSafety)));
  const maxLines = Math.min(maxLinesByHeight, options.maxLines || Number.POSITIVE_INFINITY);
  const estimatedLines = String(value || "").split("\n").reduce((sum, paragraph) => {
    if (!paragraph.trim()) return sum + 0.65;
    return sum + Math.max(1, Math.ceil(textUnits(paragraph) / unitsPerLine));
  }, 0);
  return { estimatedLines, maxLines, unitsPerLine, lineSpacing };
}

export function fitPptText(value, position, options = {}) {
  const preferredFontSize = options.fontSize || 22;
  const minFontSize = Math.min(preferredFontSize, options.minFontSize || 16);
  const hardMinFontSize = Math.min(minFontSize, options.hardMinFontSize || 11);
  const raw = String(value || "").replace(/\r/g, "").trim();
  const compact = raw.replace(/\n\s*\n+/g, "\n");
  const variants = raw === compact ? [raw] : [raw, compact];
  const lineSpacing = options.lineSpacing || 1.18;
  const tryFit = (fontSize, spacing, texts) => {
    for (const text of texts) {
      const metrics = pptTextMetrics(text, position, fontSize, { ...options, lineSpacing: spacing });
      if (metrics.estimatedLines <= metrics.maxLines) {
        return { text, fontSize, lineSpacing: spacing, truncated: false, ...metrics };
      }
    }
    return null;
  };
  for (let fontSize = preferredFontSize; fontSize >= minFontSize; fontSize -= 1) {
    const hit = tryFit(fontSize, lineSpacing, variants);
    if (hit) return hit;
  }

  if (options.ellipsis === false) {
    for (let fontSize = minFontSize - 1; fontSize >= hardMinFontSize; fontSize -= 1) {
      for (const spacing of [lineSpacing, 1.08, 1.02]) {
        const hit = tryFit(fontSize, spacing, variants);
        if (hit) return hit;
      }
    }
    const metrics = pptTextMetrics(compact, position, hardMinFontSize, { ...options, lineSpacing: 1.02 });
    return { text: compact, fontSize: hardMinFontSize, lineSpacing: 1.02, truncated: false, ...metrics };
  }

  const suffix = "…";
  let low = 0;
  let high = compact.length;
  let fitted = suffix;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const prefix = compact.slice(0, middle).trimEnd().replace(/[，。；：、,.!?！？;:]+$/u, "");
    const candidate = `${prefix}${suffix}`;
    const metrics = pptTextMetrics(candidate, position, minFontSize, { ...options, lineSpacing });
    if (metrics.estimatedLines <= metrics.maxLines) {
      fitted = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  const metrics = pptTextMetrics(fitted, position, minFontSize, { ...options, lineSpacing });
  return { text: fitted, fontSize: minFontSize, lineSpacing, truncated: true, ...metrics };
}

export function fitPptNumberedList(items, position, options = {}) {
  const values = (Array.isArray(items) ? items : []).slice(0, options.maxItems || 5).map(stripOrdinal);
  const source = values.length ? values : ["待补充"];
  const preferredFontSize = options.fontSize || 20;
  const minFontSize = Math.min(preferredFontSize, options.minFontSize || 16);
  const lineSpacing = options.lineSpacing || 1.16;
  const render = (list, separator) => list
    .map((item, index) => `${String(index + 1).padStart(2, "0")}  ${item}`)
    .join(separator);

  for (let fontSize = preferredFontSize; fontSize >= minFontSize; fontSize -= 1) {
    for (const separator of ["\n\n", "\n"]) {
      const text = render(source, separator);
      const metrics = pptTextMetrics(text, position, fontSize, { ...options, lineSpacing });
      if (metrics.estimatedLines <= metrics.maxLines) {
        return { text, fontSize, lineSpacing, truncated: false, ...metrics };
      }
    }
  }

  const baseMetrics = pptTextMetrics("", position, minFontSize, { ...options, lineSpacing });
  const linesPerItem = Math.max(1, Math.floor(baseMetrics.maxLines / source.length));
  const prefixUnits = textUnits("00  ");
  let perItemUnits = Math.max(5, Math.floor(linesPerItem * baseMetrics.unitsPerLine - prefixUnits - 1));
  while (perItemUnits >= 5) {
    const shortened = source.map((item) => truncateByUnits(item, perItemUnits));
    const text = render(shortened, "\n");
    const metrics = pptTextMetrics(text, position, minFontSize, { ...options, lineSpacing });
    if (metrics.estimatedLines <= metrics.maxLines) {
      return { text, fontSize: minFontSize, lineSpacing, truncated: true, ...metrics };
    }
    perItemUnits -= 1;
  }

  return fitPptText(render(source.map((item) => truncateByUnits(item, 5)), "\n"), position, {
    ...options,
    fontSize: minFontSize,
    minFontSize,
    lineSpacing,
  });
}

function addText(slide, text, position, style = {}) {
  const box = slide.shapes.add({
    geometry: "textbox",
    position,
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  box.text = String(text || "");
  box.text.style = {
    fontSize: style.fontSize || 22,
    typeface: PPT_FONT,
    color: style.color || C.ink,
    bold: Boolean(style.bold),
    italic: Boolean(style.italic),
    alignment: style.alignment || "left",
    verticalAlignment: style.verticalAlignment || (String(text || "").includes("\n") ? "top" : "middle"),
    lineSpacing: style.lineSpacing || 1.18,
    wrap: style.wrap || "square",
    autoFit: style.autoFit || "none",
    insets: style.insets || { top: 0, right: 0, bottom: 0, left: 0 },
  };
  return box;
}

function addFittedText(slide, value, position, style = {}) {
  const fit = fitPptText(value, position, { ...style, ellipsis: style.ellipsis ?? false });
  return addText(slide, fit.text, position, {
    ...style,
    fontSize: fit.fontSize,
    lineSpacing: fit.lineSpacing,
    verticalAlignment: "top",
    autoFit: "shrinkText",
  });
}

function addFittedList(slide, items, position, style = {}) {
  const values = (Array.isArray(items) ? items : [])
    .slice(0, style.maxItems || 5)
    .map(stripOrdinal);
  const source = values.length ? values : ["待补充"];
  const gap = style.itemGap ?? 4;
  const rowHeight = Math.max(20, (position.height - gap * (source.length - 1)) / source.length);
  return source.map((item, index) => {
    const numberWidth = Math.min(38, Math.max(30, position.width * 0.12));
    const rowPosition = {
      left: position.left + numberWidth,
      top: position.top + index * (rowHeight + gap),
      width: position.width - numberWidth,
      height: rowHeight,
    };
    addText(slide, String(index + 1).padStart(2, "0"), {
      left: position.left,
      top: rowPosition.top,
      width: numberWidth - 8,
      height: Math.min(rowHeight, 28),
    }, {
      ...style,
      fontSize: Math.min(style.fontSize || 20, 18),
      minFontSize: 16,
      color: style.numberColor || style.color || C.ink,
      bold: Boolean(style.numberBold),
      verticalAlignment: "top",
    });
    return addFittedText(slide, item, rowPosition, {
      ...style,
      maxLines: Math.max(1, Math.floor(rowHeight / ((style.minFontSize || 16) * (style.lineSpacing || 1.16)))),
      verticalAlignment: "top",
    });
  });
}

function addRect(slide, position, fill, radius = "rounded-xl", line = "none") {
  return slide.shapes.add({
    geometry: radius === "none" ? "rect" : "roundRect",
    position,
    fill,
    line: { style: "solid", fill: line, width: line === "none" ? 0 : 1 },
    borderRadius: radius === "none" ? undefined : radius,
  });
}

function addSlideChrome(slide, section, page) {
  addText(slide, `${String(page).padStart(2, "0")}  ·  ${section.toUpperCase()}`, { left: 64, top: 28, width: 480, height: 24 }, {
    fontSize: 16, color: C.mint, bold: true,
  });
}

function addTitle(slide, title, subtitle = "") {
  const oneLineTitle = conciseVisible(title, 34, "核心结论");
  const titleSize = textUnits(oneLineTitle) > 29 ? 35 : textUnits(oneLineTitle) > 24 ? 40 : 46;
  addText(slide, oneLineTitle, { left: 64, top: 78, width: 1152, height: 68 }, {
    fontSize: titleSize, bold: true, wrap: "none",
  });
  if (subtitle) {
    addText(slide, conciseVisible(subtitle, 76), { left: 64, top: 164, width: 1120, height: 36 }, {
      fontSize: 20, color: C.muted,
    });
  }
}

async function normalizePptxTypography(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xmlNames = Object.keys(zip.files).filter((name) => name.startsWith("ppt/") && name.endsWith(".xml"));
  await Promise.all(xmlNames.map(async (name) => {
    const file = zip.file(name);
    if (!file) return;
    const xml = await file.async("string");
    const normalized = xml.replace(
      /<(a:(?:latin|ea|cs|font))\b([^>]*?)\btypeface="[^"]*"/g,
      (_match, tag, attributes) => `<${tag}${attributes}typeface="${PPT_FONT}"`,
    );
    if (normalized !== xml) zip.file(name, normalized);
  }));
  return zip.generateAsync({ type: "nodebuffer" });
}

function addNotes(slide, talkTrack, sources = []) {
  const sourceLines = sources.length
    ? sources.map((source) => `- ${source.title || source.id || "来源"}${source.url ? ` | ${source.url}` : ""}`)
    : ["- 用户输入与本次分析数据；无外部链接。"];
  slide.speakerNotes.textFrame.setText([
    "【汇报备注】",
    ...talkTrack,
    "",
    "[Sources]",
    ...sourceLines,
  ]);
  slide.speakerNotes.setVisible(true);
}

function listText(items, max = 5) {
  const values = Array.isArray(items) ? items.slice(0, max) : [];
  return values.length ? values.map((item, index) => `${String(index + 1).padStart(2, "0")}  ${pptTruncate(stripOrdinal(item), 50)}`).join("\n\n") : "01  待补充";
}

function scoreFill(score) {
  if (score >= 8) return C.mint;
  if (score >= 6.5) return C.blue;
  if (score >= 5) return C.warning;
  return C.red;
}

function sourceSubset(analysis, limit = 4) {
  return (analysis.evidence || []).slice(0, limit);
}

function sourcesByIds(analysis, ids, limit = 8) {
  const requested = new Set((ids || []).filter(Boolean));
  return (analysis.evidence || []).filter((item) => requested.has(item.id)).slice(0, limit);
}

function detectImageContentType(value, bytes) {
  const source = String(value || "").toLowerCase();
  if (source.includes("image/png") || source.endsWith(".png")) return "image/png";
  if (source.includes("image/webp") || source.endsWith(".webp")) return "image/webp";
  if (source.includes("image/gif") || source.endsWith(".gif")) return "image/gif";
  if (bytes?.[0] === 0x89 && bytes?.[1] === 0x50 && bytes?.[2] === 0x4e && bytes?.[3] === 0x47) return "image/png";
  return "image/jpeg";
}

async function loadInterfaceImage(audit = {}) {
  const imagePath = String(audit.imagePath || "").trim();
  const imageUrl = String(audit.imageUrl || "").trim();
  const candidates = [];
  if (imagePath) candidates.push(imagePath);
  if (imageUrl.startsWith("/")) {
    const relative = decodeURIComponent(imageUrl.replace(/^\/+/, ""));
    const publicRoot = path.resolve(process.cwd(), "public");
    const resolved = path.resolve(publicRoot, relative);
    if (resolved === publicRoot || resolved.startsWith(`${publicRoot}${path.sep}`)) candidates.push(resolved);
  } else if (imageUrl && !/^https?:\/\//iu.test(imageUrl) && !/^data:/iu.test(imageUrl)) {
    candidates.push(path.resolve(process.cwd(), imageUrl));
  }

  for (const candidate of [...new Set(candidates)]) {
    try {
      const bytes = await fs.readFile(candidate);
      return { bytes, contentType: detectImageContentType(candidate, bytes) };
    } catch {
      // Continue to the next source. A later remote URL may still be available.
    }
  }

  if (/^data:image\//iu.test(imageUrl)) {
    const match = imageUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/iu);
    if (match) {
      const bytes = Buffer.from(match[2], "base64");
      return { bytes, contentType: match[1].toLowerCase() };
    }
  }

  if (/^https?:\/\//iu.test(imageUrl)) {
    try {
      const response = await fetch(imageUrl, { signal: AbortSignal.timeout(12000) });
      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        return {
          bytes,
          contentType: response.headers.get("content-type")?.split(";")[0] || detectImageContentType(imageUrl, bytes),
        };
      }
    } catch {
      // The slide will render an explicit evidence-gap state instead of failing export.
    }
  }

  return null;
}

function addPptImage(slide, image, position, alt) {
  slide.images.add({
    blob: image.bytes.buffer.slice(image.bytes.byteOffset, image.bytes.byteOffset + image.bytes.byteLength),
    contentType: image.contentType,
    alt,
    fit: "contain",
    position,
    geometry: "roundRect",
    borderRadius: "rounded-xl",
  });
}

function interfaceSources(group) {
  return (group.interfaceAudit || [])
    .filter((item) => item.sourceUrl)
    .map((item) => ({ title: `${group.competitorName} · ${item.screen}`, url: item.sourceUrl }));
}

function renumberSlideChrome(slideProto, pageNumber) {
  const visit = (elements = []) => {
    for (const element of elements) {
      for (const paragraph of element.paragraphs || []) {
        for (const run of paragraph.runs || []) {
          if (/^\d{2}\s+·\s+/u.test(run.text || "")) {
            run.text = String(run.text).replace(/^\d{2}/u, String(pageNumber).padStart(2, "0"));
            return true;
          }
        }
      }
      if (visit(element.children || [])) return true;
    }
    return false;
  };
  visit(slideProto.elements || []);
}

function reorderPresentation(deck, indexes) {
  const proto = deck.toProto();
  const uniqueIndexes = [...new Set(indexes)].filter((index) => Number.isInteger(index) && index >= 0 && index < proto.slides.length);
  const selected = uniqueIndexes.map((index) => proto.slides[index]).filter(Boolean);
  if (!selected.length) return deck;
  selected.forEach((slide, index) => {
    slide.index = index;
    renumberSlideChrome(slide, index + 1);
  });
  proto.slides = selected;
  return Presentation.load(proto);
}

async function buildLegacyPptx(rawAnalysis) {
  const a = normalizeAnalysis(rawAnalysis);
  const deck = Presentation.create({ slideSize: { width: PPT_W, height: PPT_H } });

  // 1. Minimal title.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.ink;
    addText(slide, "AI COMPETITOR INTELLIGENCE", { left: 72, top: 76, width: 560, height: 28 }, {
      fontSize: 16, color: C.lime, bold: true,
    });
    const coverTitle = pptTruncate(a.meta.title, 52).replace(/（/, "\n（");
    addText(slide, coverTitle, { left: 72, top: 188, width: 875, height: 150 }, {
      fontSize: 62, color: C.white, bold: true,
    });
    addText(slide, pptTruncate(a.meta.decisionQuestion, 78), { left: 72, top: 384, width: 850, height: 80 }, {
      fontSize: 28, color: "#D8E5DF",
    });
    addRect(slide, { left: 1010, top: 160, width: 150, height: 350 }, C.accent, "rounded-2xl");
    addText(slide, `${a.competitors.length}\n分析对象`, { left: 1025, top: 205, width: 120, height: 100 }, {
      fontSize: 21, color: C.white, bold: true, alignment: "center",
    });
    addText(slide, `${a.evidence.length}\n证据条目`, { left: 1025, top: 350, width: 120, height: 100 }, {
      fontSize: 21, color: C.white, bold: true, alignment: "center",
    });
    const researchLabel = a.research.mode === "web_search" ? `联网调研 · ${a.research.searchCalls} 次搜索` : a.research.mode === "demo" ? "演示数据" : "离线材料分析";
    addText(slide, `${a.meta.date}  |  ${a.meta.audience}  |  ${researchLabel}`, { left: 72, top: 625, width: 820, height: 28 }, {
      fontSize: 16, color: "#AABCB4",
    });
    addNotes(slide, [
      `开场先抛出决策问题：“${a.meta.decisionQuestion}”`,
      "说明这不是功能清单，而是面向下一步资源配置的证据化分析。",
      `调研状态：${a.research.status}；${a.research.summary}`,
    ], sourceSubset(a));
  }

  // 2. Executive verdict.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Executive verdict", 2);
    addTitle(slide, a.executiveSummary.headline, a.executiveSummary.verdict);
    addRect(slide, { left: 64, top: 230, width: 690, height: 390 }, C.white, "rounded-2xl", C.line);
    addText(slide, "我们看到了什么", { left: 100, top: 260, width: 300, height: 34 }, { fontSize: 24, bold: true });
    addText(slide, listText(a.executiveSummary.insights, 4), { left: 100, top: 310, width: 610, height: 260 }, { fontSize: 21 });
    addRect(slide, { left: 790, top: 230, width: 426, height: 390 }, C.ink, "rounded-2xl");
    addText(slide, "下一步", { left: 830, top: 260, width: 180, height: 34 }, { fontSize: 24, color: C.lime, bold: true });
    addText(slide, listText(a.executiveSummary.actions, 4), { left: 830, top: 310, width: 346, height: 260 }, { fontSize: 19, color: C.white });
    addNotes(slide, [
      "先读标题结论，再用左侧三条证据解释为什么。",
      "右侧只讲需要当场确认的动作；不要在此页展开实现细节。",
    ], sourceSubset(a));
  }

  // 3. Market stage.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Market & timing", 3);
    addTitle(slide, `行业处于“${a.market.stage}”`, a.market.trend);
    const stages = ["技术萌芽", "摸索成长", "上升红利", "应用爆发", "增长泡沫", "成熟工具"];
    stages.forEach((stage, index) => {
      const active = a.market.stage.includes(stage.slice(0, 2));
      const x = 70 + index * 194;
      addRect(slide, { left: x, top: 260, width: 160, height: active ? 130 : 92 }, active ? C.accent : C.white, "rounded-xl", active ? C.accent : C.line);
      addText(slide, stage, { left: x + 12, top: 280, width: 136, height: 48 }, {
        fontSize: 20, bold: active, color: active ? C.white : C.ink, alignment: "center",
      });
      if (index < stages.length - 1) {
        addText(slide, "→", { left: x + 160, top: 288, width: 34, height: 34 }, { fontSize: 26, color: C.muted, alignment: "center" });
      }
    });
    const signals = [
      ["规模信号", a.market.sizeSignal],
      ["里程碑", a.market.milestone],
      ["下一转折", a.market.nextInflection],
    ];
    signals.forEach(([label, value], index) => {
      const x = 70 + index * 388;
      addText(slide, label, { left: x, top: 455, width: 170, height: 28 }, { fontSize: 17, color: C.mint, bold: true });
      addText(slide, pptTruncate(value, 40), { left: x, top: 490, width: 340, height: 95 }, { fontSize: 22, bold: true });
    });
    addNotes(slide, [
      "用阶段判断解释竞争策略：当前阶段应该验证什么、抢什么、避免什么。",
      `特别强调下一转折：“${a.market.nextInflection}”。`,
    ], sourceSubset(a));
  }

  // 4. Total score comparison.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Competitive score", 4);
    addTitle(slide, "综合分只用于定位，真正的差异来自分项证据", "九维权重：市场、体验、AI、信任、增长、商业、成本、生态、创新");
    const competitors = a.competitors.slice(0, 6);
    slide.charts.add("bar", {
      position: { left: 72, top: 220, width: 720, height: 390 },
      categories: competitors.map((item) => item.name),
      series: [{ name: "加权总分", values: competitors.map((item) => item.score), fill: C.mint }],
      hasLegend: false,
      dataLabels: { showValue: true, position: "outEnd", textStyle: { fontSize: 16, fill: C.ink, bold: true } },
      xAxis: { minimumScale: 0, maximumScale: 10, majorUnit: 2, textStyle: { fontSize: 16, fill: C.muted }, majorGridlines: { style: "solid", fill: C.line, width: 1 } },
      yAxis: { textStyle: { fontSize: 16, fill: C.muted } },
    });
    addRect(slide, { left: 840, top: 220, width: 376, height: 390 }, C.ink, "rounded-2xl");
    addText(slide, "读图方式", { left: 878, top: 254, width: 200, height: 34 }, { fontSize: 24, color: C.lime, bold: true });
    addText(slide, "1  看领先差距\n\n2  找可迁移能力\n\n3  回到分项证据\n\n4  不用总分替代决策", { left: 878, top: 312, width: 290, height: 240 }, { fontSize: 23, color: C.white });
    addNotes(slide, [
      "不要把总分当作排行榜；先看本品与领先者的结构性差距。",
      "下一页会拆开九维，定位可行动的长短板。",
    ], sourceSubset(a));
  }

  // 5. Nine dimensions.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Capability anatomy", 5);
    addTitle(slide, "九维拆解揭示真正需要投入的能力", `北极星：${a.northStar.metric}`);
    const competitors = a.competitors.slice(0, 4);
    slide.charts.add("bar", {
      position: { left: 60, top: 220, width: 850, height: 420 },
      categories: DIMENSIONS.map((item) => item.label),
      series: competitors.map((competitor, index) => ({
        name: competitor.name,
        values: DIMENSIONS.map((item) => competitor.scores[item.key]),
        fill: [C.accent, C.mint, C.blue, C.warning][index],
      })),
      hasLegend: true,
      legend: { position: "bottom", textStyle: { fontSize: 16, fill: C.muted } },
      xAxis: { textStyle: { fontSize: 16, fill: C.muted } },
      yAxis: { minimumScale: 0, maximumScale: 10, majorUnit: 2, textStyle: { fontSize: 16, fill: C.muted }, majorGridlines: { style: "solid", fill: C.line, width: 1 } },
    });
    addRect(slide, { left: 950, top: 220, width: 266, height: 420 }, C.white, "rounded-2xl", C.line);
    addText(slide, "指标护栏", { left: 980, top: 252, width: 190, height: 32 }, { fontSize: 23, bold: true });
    addText(slide, listText(a.northStar.guardrails, 5), { left: 980, top: 310, width: 210, height: 270 }, { fontSize: 20 });
    addNotes(slide, [
      "逐项解释分数背后的证据，而不是只读高低。",
      `所有投入都要服务北极星指标“${a.northStar.metric}”，并受右侧护栏约束。`,
    ], sourcesByIds(a, competitors.flatMap((competitor) => (
      Object.values(competitor.scoreRationales || {}).flatMap((item) => item.evidenceIds || [])
    ))));
  }

  // 6. AI moat.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "AI moat", 6);
    addTitle(slide, "AI 护城河不是一个模型，而是一条可持续增强的链路", "模型策略 → 体验质量 → 可靠与安全 → 数据飞轮 → 生态集成");
    const focus = a.competitors[0] || { aiProfile: {}, name: a.meta.product };
    const chain = [
      ["模型策略", focus.aiProfile.modelStrategy],
      ["效果与时延", `${focus.aiProfile.quality} / ${focus.aiProfile.latency}`],
      ["可靠与隐私", `${focus.aiProfile.reliability} / ${focus.aiProfile.privacy}`],
      ["数据飞轮", focus.aiProfile.dataFlywheel],
      ["集成与成本", `${focus.aiProfile.integration} / ${focus.aiProfile.cost}`],
    ];
    chain.forEach(([label, value], index) => {
      const x = 70 + index * 234;
      addRect(slide, { left: x, top: 270, width: 195, height: 240 }, index === 2 ? C.ink : C.white, "rounded-2xl", index === 2 ? C.ink : C.line);
      addText(slide, String(index + 1).padStart(2, "0"), { left: x + 22, top: 292, width: 44, height: 32 }, {
        fontSize: 17, color: index === 2 ? C.lime : C.mint, bold: true,
      });
      addText(slide, label, { left: x + 22, top: 338, width: 150, height: 50 }, {
        fontSize: 24, color: index === 2 ? C.white : C.ink, bold: true,
      });
      addText(slide, pptTruncate(value, 44), { left: x + 22, top: 410, width: 150, height: 70 }, {
        fontSize: 18, color: index === 2 ? "#D8E5DF" : C.muted,
      });
      if (index < chain.length - 1) {
        addText(slide, "→", { left: x + 195, top: 365, width: 39, height: 34 }, { fontSize: 26, color: C.accent, alignment: "center" });
      }
    });
    addText(slide, `本品：${focus.name}`, { left: 72, top: 555, width: 360, height: 34 }, { fontSize: 20, color: C.mint, bold: true });
    addNotes(slide, [
      "用链路而非单点模型参数解释 AI 竞争力。",
      "指出当前最薄弱的一环，以及它如何限制后续数据飞轮或商业化。",
    ], sourceSubset(a));
  }

  // 7. Commercial efficiency.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Commercial efficiency", 7);
    addTitle(slide, "商业效率要同时提高访问、ARPU 与回访", a.economics.model);
    const rockets = [
      ["01", "提高访问", a.economics.acquisition],
      ["02", "提高 ARPU", a.economics.arpu],
      ["03", "提高回访", a.economics.retention],
    ];
    rockets.forEach(([num, label, value], index) => {
      const x = 70 + index * 388;
      addRect(slide, { left: x, top: 235, width: 340, height: 300 }, [C.accent, C.mint, C.ink][index], "rounded-2xl");
      addText(slide, num, { left: x + 32, top: 266, width: 60, height: 34 }, { fontSize: 18, color: index === 2 ? C.lime : C.white, bold: true });
      addText(slide, label, { left: x + 32, top: 326, width: 270, height: 52 }, { fontSize: 32, color: C.white, bold: true });
      addText(slide, pptTruncate(value, 60), { left: x + 32, top: 400, width: 270, height: 95 }, { fontSize: 21, color: C.white });
    });
    addText(slide, `效率杠杆：${a.economics.efficiencyLevers.slice(0, 3).join("  /  ") || "待验证"}`, { left: 72, top: 580, width: 1120, height: 38 }, { fontSize: 20, color: C.muted });
    addNotes(slide, [
      "用三级火箭把收入问题拆成可优化的具体环节。",
      "每个环节都要给出一个指标、一个最小实验和一个停止条件。",
    ], sourceSubset(a));
  }

  // 8. Opportunity portfolio.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Opportunity portfolio", 8);
    addTitle(slide, "优先做高影响、高信心、可控投入的机会", "横轴：投入；纵轴：影响；气泡颜色：时间窗口");
    addRect(slide, { left: 80, top: 220, width: 790, height: 410 }, C.white, "rounded-2xl", C.line);
    addText(slide, "高影响", { left: 92, top: 230, width: 100, height: 24 }, { fontSize: 16, color: C.muted });
    addText(slide, "低投入", { left: 92, top: 592, width: 100, height: 24 }, { fontSize: 16, color: C.muted });
    addText(slide, "高投入", { left: 765, top: 592, width: 90, height: 24 }, { fontSize: 16, color: C.muted, alignment: "right" });
    addRect(slide, { left: 474, top: 240, width: 2, height: 350 }, C.line, "none");
    addRect(slide, { left: 115, top: 420, width: 720, height: 2 }, C.line, "none");
    const horizonColors = { Now: C.accent, Next: C.mint, Later: C.blue };
    a.opportunities.slice(0, 7).forEach((item, index) => {
      const x = 115 + (item.effort / 10) * 670;
      const y = 570 - (item.impact / 10) * 300;
      const size = 46 + item.confidence * 4;
      addRect(slide, { left: x - size / 2, top: y - size / 2, width: size, height: size }, horizonColors[item.horizon], "rounded-2xl");
      addText(slide, String(index + 1), { left: x - 18, top: y - 15, width: 36, height: 30 }, { fontSize: 18, color: C.white, bold: true, alignment: "center" });
    });
    addRect(slide, { left: 920, top: 220, width: 296, height: 410 }, C.ink, "rounded-2xl");
    addText(slide, "机会清单", { left: 950, top: 250, width: 200, height: 34 }, { fontSize: 24, color: C.lime, bold: true });
    addText(slide, a.opportunities.slice(0, 7).map((item, index) => `${index + 1}  ${pptTruncate(item.title, 18)}`).join("\n\n") || "待补充", { left: 950, top: 305, width: 230, height: 280 }, { fontSize: 20, color: C.white });
    addNotes(slide, [
      "先讲左上象限，再解释为什么某些看起来很大的机会被延后。",
      "气泡大小代表信心；低信心机会应先做证据实验。",
    ], sourcesByIds(a, a.opportunities.flatMap((item) => item.evidenceIds || [])));
  }

  // 9. Roadmap.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Roadmap", 9);
    addTitle(slide, "把竞品洞察转成三段式行动路线", "Now 验证关键假设，Next 放大有效能力，Later 建立长期壁垒");
    const columns = [
      ["NOW · 0–8 周", a.roadmap.now, C.accent],
      ["NEXT · 2–6 月", a.roadmap.next, C.mint],
      ["LATER · 6 月+", a.roadmap.later, C.ink],
    ];
    columns.forEach(([label, items, color], index) => {
      const x = 70 + index * 388;
      addRect(slide, { left: x, top: 230, width: 340, height: 360 }, C.white, "rounded-2xl", C.line);
      addRect(slide, { left: x, top: 230, width: 340, height: 68 }, color, "rounded-xl");
      addText(slide, label, { left: x + 26, top: 246, width: 280, height: 36 }, { fontSize: 22, color: C.white, bold: true });
      addText(slide, listText(items, 5), { left: x + 30, top: 330, width: 280, height: 210 }, { fontSize: 22 });
    });
    addNotes(slide, [
      "逐段确认目标、负责人、成功指标和依赖资源。",
      "Now 阶段的重点是消除最大不确定性，而不是一次性做全。",
    ], sourceSubset(a));
  }

  // 10. Decision close.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.ink;
    addText(slide, "DECISION", { left: 72, top: 70, width: 240, height: 30 }, { fontSize: 16, color: C.lime, bold: true });
    addText(slide, pptTruncate(a.executiveSummary.verdict, 72), { left: 72, top: 158, width: 920, height: 170 }, { fontSize: 58, color: C.white, bold: true });
    addRect(slide, { left: 72, top: 405, width: 1136, height: 150 }, C.accent, "rounded-2xl");
    addText(slide, "需要确认", { left: 108, top: 432, width: 180, height: 30 }, { fontSize: 19, color: C.white, bold: true });
    addText(slide, pptTruncate(a.meta.decisionQuestion, 92), { left: 108, top: 472, width: 1020, height: 56 }, { fontSize: 30, color: C.white, bold: true });
    addText(slide, `证据 ${a.evidence.length} 条  ·  评分覆盖 ${a.audit.scoreEvidenceCoverage}%  ·  机会覆盖 ${a.audit.opportunityEvidenceCoverage}%`, { left: 72, top: 630, width: 760, height: 28 }, { fontSize: 16, color: "#AABCB4" });
    addNotes(slide, [
      "回到开场的决策问题，明确希望会议做出的选择。",
      "如果尚不能决策，确认下一轮证据负责人和截止时间。",
    ], sourceSubset(a));
  }

  const temp = path.join(os.tmpdir(), `ai-ca-${crypto.randomUUID()}.pptx`);
  try {
    const file = await PresentationFile.exportPptx(deck);
    await file.save(temp);
    return await normalizePptxTypography(await fs.readFile(temp));
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
    await fs.rm(`${temp}.inspect.ndjson`, { force: true }).catch(() => {});
  }
}

async function buildPptxV12(rawAnalysis) {
  const a = normalizeAnalysis(rawAnalysis);
  const deck = Presentation.create({ slideSize: { width: PPT_W, height: PPT_H } });
  const visibleList = (value, fallback = "待验证") => {
    const values = Array.isArray(value) ? value.filter(Boolean).map(String) : [];
    return values.length ? values : [fallback];
  };
  const joined = (value, fallback = "待验证") => visibleList(value, fallback).join("；");
  const focus = a.competitors[0] || {
    name: a.meta.product,
    role: "本品",
    aiProfile: {},
    strengths: [],
    weaknesses: [],
    coreJobs: [],
  };

  // 1. Cover: context and decision question only.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.ink;
    addText(slide, "AI COMPETITOR INTELLIGENCE", { left: 72, top: 72, width: 560, height: 30 }, {
      fontSize: 16, color: C.lime, bold: true,
    });
    addFittedText(slide, a.meta.title, { left: 72, top: 174, width: 850, height: 160 }, {
      fontSize: 62, minFontSize: 46, lineSpacing: 1.02, color: C.white, bold: true, maxLines: 3,
    });
    addFittedText(slide, a.meta.decisionQuestion, { left: 72, top: 382, width: 850, height: 82 }, {
      fontSize: 28, minFontSize: 22, color: "#D8E5DF", lineSpacing: 1.16, maxLines: 3,
    });
    addRect(slide, { left: 1010, top: 160, width: 150, height: 350 }, C.accent, "rounded-2xl");
    addText(slide, `${a.competitors.length}\n分析对象`, { left: 1025, top: 205, width: 120, height: 100 }, {
      fontSize: 21, color: C.white, bold: true, alignment: "center", verticalAlignment: "middle",
    });
    addText(slide, `${a.evidence.length}\n证据条目`, { left: 1025, top: 350, width: 120, height: 100 }, {
      fontSize: 21, color: C.white, bold: true, alignment: "center", verticalAlignment: "middle",
    });
    const researchLabel = a.research.mode === "web_search" ? `联网调研 · ${a.research.searchCalls} 次搜索` : a.research.mode === "demo" ? "演示数据" : "离线材料分析";
    addText(slide, `${a.meta.date}  |  ${a.meta.audience}  |  ${researchLabel}`, { left: 72, top: 625, width: 820, height: 28 }, {
      fontSize: 16, color: "#AABCB4",
    });
    addNotes(slide, [
      `开场只回答一个问题：“${a.meta.decisionQuestion}”`,
      "后续按需求、场景、功能、服务水平和商业化逐层收敛到决策。",
    ], sourceSubset(a));
  }

  // 2. Executive verdict: decision first, evidence second.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Executive verdict", 2);
    addTitle(slide, a.executiveSummary.headline, a.executiveSummary.verdict);
    addRect(slide, { left: 64, top: 230, width: 690, height: 390 }, C.white, "rounded-2xl", C.line);
    addText(slide, "判断依据", { left: 100, top: 260, width: 300, height: 34 }, { fontSize: 24, bold: true });
    addFittedList(slide, a.executiveSummary.insights, { left: 100, top: 310, width: 610, height: 270 }, {
      fontSize: 20, minFontSize: 16, maxItems: 4, lineSpacing: 1.14,
    });
    addRect(slide, { left: 790, top: 230, width: 426, height: 390 }, C.ink, "rounded-2xl");
    addText(slide, "优先动作", { left: 830, top: 260, width: 220, height: 34 }, { fontSize: 24, color: C.lime, bold: true });
    addFittedList(slide, a.executiveSummary.actions, { left: 830, top: 310, width: 346, height: 270 }, {
      fontSize: 19, minFontSize: 16, maxItems: 4, color: C.white, lineSpacing: 1.14,
    });
    addNotes(slide, [
      "先讲结论，再说明四条判断依据。",
      "右侧动作必须能在路线图与机会执行卡中找到对应项。",
    ], sourceSubset(a));
  }

  // 3. User demand and scenarios: what users hire the product to do.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Demand & scenarios", 3);
    const personaNames = a.userNeeds.personas.slice(0, 3).map((item) => item.name).join("、") || "知识工作者与企业团队";
    addTitle(slide, "真正被购买的不是对话，而是可验收的任务闭环", `核心用户：${personaNames}`);
    const headers = ["关键场景", "触发时刻", "用户要完成的任务", "可验收结果"];
    const widths = [190, 220, 370, 356];
    let x = 72;
    headers.forEach((header, index) => {
      addRect(slide, { left: x, top: 228, width: widths[index], height: 46 }, C.ink, "none");
      addText(slide, header, { left: x + 14, top: 238, width: widths[index] - 28, height: 26 }, { fontSize: 17, color: C.white, bold: true });
      x += widths[index];
    });
    const scenarios = a.userNeeds.scenarios.slice(0, 4);
    const rows = scenarios.length ? scenarios : [{ name: "待补充场景", trigger: "待验证", task: "待验证", outcome: "待验证" }];
    rows.forEach((item, rowIndex) => {
      const top = 274 + rowIndex * 74;
      const fill = rowIndex % 2 ? C.paper : C.white;
      const values = [item.name, item.trigger, item.task, item.outcome];
      let cellX = 72;
      values.forEach((value, index) => {
        addRect(slide, { left: cellX, top, width: widths[index], height: 74 }, fill, "none", C.line);
        addFittedText(slide, value, { left: cellX + 14, top: top + 10, width: widths[index] - 28, height: 54 }, {
          fontSize: index === 0 ? 18 : 17,
          minFontSize: 16,
          bold: index === 0,
          lineSpacing: 1.12,
          maxLines: 3,
        });
        cellX += widths[index];
      });
    });
    addRect(slide, { left: 72, top: 588, width: 1136, height: 58 }, "#E6EEE9", "rounded-xl");
    addFittedText(slide, `核心阻力：${a.userNeeds.painPoints.slice(0, 4).join("  /  ") || "待补充"}`, { left: 94, top: 600, width: 1092, height: 34 }, {
      fontSize: 18, minFontSize: 16, color: C.muted, lineSpacing: 1.08, maxLines: 2,
    });
    addNotes(slide, [
      "逐行讲清楚用户在什么时刻触发、交给 Agent 什么任务、如何验收。",
      "后续所有功能与服务指标都必须能回到这些场景。",
    ], sourcesByIds(a, scenarios.flatMap((item) => item.evidenceIds || [])));
  }

  // 4. Market timing: why this decision is urgent now.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Market & timing", 4);
    addTitle(slide, `行业正处于“${a.market.stage}”`, a.market.trend);
    const stages = ["技术萌芽", "摸索成长", "上升红利", "应用爆发", "增长泡沫", "成熟工具"];
    stages.forEach((stage, index) => {
      const active = a.market.stage.includes(stage.slice(0, 2));
      const stageX = 70 + index * 194;
      addRect(slide, { left: stageX, top: 258, width: 160, height: active ? 126 : 92 }, active ? C.accent : C.white, "rounded-xl", active ? C.accent : C.line);
      addText(slide, stage, { left: stageX + 12, top: 278, width: 136, height: 48 }, {
        fontSize: 20, bold: active, color: active ? C.white : C.ink, alignment: "center", verticalAlignment: "middle",
      });
      if (index < stages.length - 1) {
        addText(slide, "→", { left: stageX + 160, top: 286, width: 34, height: 34 }, { fontSize: 26, color: C.muted, alignment: "center" });
      }
    });
    const signals = [["需求信号", a.market.sizeSignal], ["竞争里程碑", a.market.milestone], ["下一转折", a.market.nextInflection]];
    signals.forEach(([label, value], index) => {
      const signalX = 70 + index * 388;
      addText(slide, label, { left: signalX, top: 448, width: 180, height: 28 }, { fontSize: 18, color: C.mint, bold: true });
      addFittedText(slide, value, { left: signalX, top: 486, width: 340, height: 108 }, {
        fontSize: 20, minFontSize: 16, bold: true, lineSpacing: 1.12, maxLines: 5,
      });
    });
    addNotes(slide, [
      "市场阶段只用于解释为何此刻要做取舍。",
      `特别强调下一转折：“${a.market.nextInflection}”。`,
    ], sourceSubset(a));
  }

  // 5. Product and feature reality: actual jobs, workflow and monetization.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Product reality", 5);
    addTitle(slide, "竞争焦点已从“能生成”转向“能交付任务结果”", "比较产品定位、真实任务、交付方式与付费模式");
    const headers = ["产品", "定位", "真实任务与功能", "交付与商业模式"];
    const widths = [150, 300, 400, 286];
    let headerX = 72;
    headers.forEach((header, index) => {
      addRect(slide, { left: headerX, top: 226, width: widths[index], height: 44 }, C.ink, "none");
      addText(slide, header, { left: headerX + 14, top: 236, width: widths[index] - 28, height: 24 }, { fontSize: 17, color: C.white, bold: true });
      headerX += widths[index];
    });
    const products = a.competitors.slice(0, 4);
    products.forEach((item, rowIndex) => {
      const top = 270 + rowIndex * 82;
      const fill = rowIndex % 2 ? C.paper : C.white;
      const realJobs = joined(item.coreJobs, joined(item.fiveLayers?.scope, "待验证"));
      const delivery = `${item.businessModel || "待验证"}；${item.pricing || "待验证"}`;
      const values = [`${item.name}\n${item.role}`, item.positioning, realJobs, delivery];
      let cellX = 72;
      values.forEach((value, index) => {
        addRect(slide, { left: cellX, top, width: widths[index], height: 82 }, fill, "none", C.line);
        addFittedText(slide, value, { left: cellX + 12, top: top + 9, width: widths[index] - 24, height: 64 }, {
          fontSize: index === 0 ? 18 : 17,
          minFontSize: 16,
          bold: index === 0,
          lineSpacing: 1.1,
          maxLines: index === 0 ? 3 : 4,
        });
        cellX += widths[index];
      });
    });
    addFittedText(slide, `本品要避免的陷阱：${joined(focus.weaknesses, "只堆功能而没有形成可验证交付")}`, { left: 72, top: 612, width: 1136, height: 38 }, {
      fontSize: 17, minFontSize: 16, color: C.muted, lineSpacing: 1.08, maxLines: 2,
    });
    addNotes(slide, [
      "不再逐条罗列功能，而是比较各产品真正替用户完成哪些任务。",
      "商业模式必须与交付深度和服务成本一起理解。",
    ], sourceSubset(a));
  }

  // 6. Capability gaps: score locates the problem, evidence explains it.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Capability gaps", 6);
    addTitle(slide, "九维评分只回答“差距在哪里”，行动必须回到证据", `北极星：${a.northStar.metric}`);
    const competitors = a.competitors.slice(0, 4);
    slide.charts.add("bar", {
      position: { left: 58, top: 220, width: 850, height: 420 },
      categories: DIMENSIONS.map((item) => item.label),
      series: competitors.map((competitor, index) => ({
        name: pptTruncate(competitor.name, 16),
        values: DIMENSIONS.map((item) => competitor.scores[item.key]),
        fill: [C.accent, C.mint, C.blue, C.warning][index],
      })),
      hasLegend: true,
      legend: { position: "bottom", textStyle: { fontSize: 16, fill: C.muted } },
      xAxis: { textStyle: { fontSize: 16, fill: C.muted } },
      yAxis: { minimumScale: 0, maximumScale: 10, majorUnit: 2, textStyle: { fontSize: 16, fill: C.muted }, majorGridlines: { style: "solid", fill: C.line, width: 1 } },
    });
    addRect(slide, { left: 948, top: 220, width: 268, height: 420 }, C.white, "rounded-2xl", C.line);
    addText(slide, "本品证据摘要", { left: 978, top: 250, width: 208, height: 34 }, { fontSize: 23, bold: true });
    addText(slide, "优势", { left: 978, top: 308, width: 100, height: 26 }, { fontSize: 17, color: C.mint, bold: true });
    addFittedList(slide, focus.strengths.slice(0, 2), { left: 978, top: 340, width: 208, height: 112 }, {
      fontSize: 17, minFontSize: 16, maxItems: 2, lineSpacing: 1.1,
    });
    addText(slide, "短板", { left: 978, top: 474, width: 100, height: 26 }, { fontSize: 17, color: C.accent, bold: true });
    addFittedList(slide, focus.weaknesses.slice(0, 2), { left: 978, top: 506, width: 208, height: 108 }, {
      fontSize: 17, minFontSize: 16, maxItems: 2, lineSpacing: 1.1,
    });
    addNotes(slide, [
      "只讲与决策相关的三项优势和三项短板。",
      "分数没有证据时应降级，不用于替代产品判断。",
    ], sourcesByIds(a, Object.values(focus.scoreRationales || {}).flatMap((item) => item.evidenceIds || [])));
  }

  // 7. Service level: turn AI capability into an operational contract.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Service level", 7);
    addTitle(slide, "企业 Agent 的服务门槛是可控、可追溯、可计费", `${focus.name}｜${focus.aiProfile.modelStrategy || "模型策略待验证"}`);
    const headers = ["服务维度", "当前能力", "最低验收线"];
    const widths = [190, 520, 426];
    let headerX = 72;
    headers.forEach((header, index) => {
      addRect(slide, { left: headerX, top: 226, width: widths[index], height: 44 }, C.ink, "none");
      addText(slide, header, { left: headerX + 14, top: 236, width: widths[index] - 28, height: 24 }, { fontSize: 17, color: C.white, bold: true });
      headerX += widths[index];
    });
    const guardrails = visibleList(a.northStar.guardrails);
    const rows = [
      ["模型路由", focus.aiProfile.modelStrategy, "模型可选、路由可解释；避免单模型锁死"],
      ["质量与时延", `${focus.aiProfile.quality}；${focus.aiProfile.latency}`, `${a.northStar.metric}；${guardrails[0] || "失败率受控"}`],
      ["可靠性", focus.aiProfile.reliability, guardrails[1] || "长任务可恢复、失败可归因"],
      ["安全与隐私", focus.aiProfile.privacy, guardrails[2] || "权限隔离、审计与数据驻留可验证"],
      ["集成与成本", `${focus.aiProfile.integration}；${focus.aiProfile.cost}`, guardrails[3] || "单位任务成本与付费转化同时受控"],
    ];
    rows.forEach((row, rowIndex) => {
      const top = 270 + rowIndex * 70;
      const fill = rowIndex % 2 ? C.paper : C.white;
      let cellX = 72;
      row.forEach((value, index) => {
        addRect(slide, { left: cellX, top, width: widths[index], height: 70 }, fill, "none", C.line);
        addFittedText(slide, value, { left: cellX + 14, top: top + 9, width: widths[index] - 28, height: 52 }, {
          fontSize: index === 0 ? 18 : 17,
          minFontSize: 16,
          bold: index === 0,
          lineSpacing: 1.1,
          maxLines: 3,
        });
        cellX += widths[index];
      });
    });
    addFittedText(slide, `数据飞轮：${focus.aiProfile.dataFlywheel || "待验证"}`, { left: 72, top: 632, width: 1136, height: 32 }, {
      fontSize: 17, minFontSize: 16, color: C.mint, bold: true, maxLines: 2,
    });
    addNotes(slide, [
      "把 AI 能力翻译成可验收的服务合同，而不是模型参数列表。",
      "重点确认质量、恢复、安全、集成和成本是否达到企业采购门槛。",
    ], sourceSubset(a));
  }

  // 8. Commercialization and data loop.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Commercial loop", 8);
    addTitle(slide, "商业化成立，必须让任务价值与单位成本同时跑通", a.economics.model);
    const commercial = [["提高访问", a.economics.acquisition, C.accent], ["提高 ARPU", a.economics.arpu, C.mint], ["提高回访", a.economics.retention, C.ink]];
    commercial.forEach(([label, value, color], index) => {
      const cardX = 72 + index * 388;
      addRect(slide, { left: cardX, top: 226, width: 340, height: 144 }, color, "rounded-2xl");
      addText(slide, label, { left: cardX + 26, top: 248, width: 280, height: 34 }, { fontSize: 24, color: C.white, bold: true });
      addFittedText(slide, value, { left: cardX + 26, top: 294, width: 288, height: 58 }, {
        fontSize: 19, minFontSize: 16, color: C.white, lineSpacing: 1.1, maxLines: 3,
      });
    });
    addText(slide, "三套数据系统把产品价值接到收入", { left: 72, top: 396, width: 500, height: 34 }, { fontSize: 24, bold: true });
    const systems = [["用户", a.dataSystems.user], ["增长", a.dataSystems.growth], ["营收", a.dataSystems.revenue]];
    systems.forEach(([label, system], index) => {
      const cardX = 72 + index * 388;
      addRect(slide, { left: cardX, top: 444, width: 340, height: 166 }, C.white, "rounded-xl", C.line);
      addText(slide, `${label}系统`, { left: cardX + 22, top: 460, width: 120, height: 28 }, { fontSize: 19, color: C.mint, bold: true });
      addFittedText(slide, system.goal, { left: cardX + 22, top: 496, width: 296, height: 48 }, {
        fontSize: 18, minFontSize: 16, bold: true, lineSpacing: 1.08, maxLines: 3,
      });
      addFittedText(slide, `指标：${joined(system.metrics.slice(0, 3), "待定义")}`, { left: cardX + 22, top: 554, width: 296, height: 38 }, {
        fontSize: 16, minFontSize: 16, color: C.muted, lineSpacing: 1.08, maxLines: 2,
      });
    });
    addFittedText(slide, "共同闭环：访问 → 首个任务 → 完成 → 复用 → 付费 → 扩席", { left: 72, top: 630, width: 1136, height: 28 }, {
      fontSize: 17, minFontSize: 16, color: C.mint, bold: true, maxLines: 1, alignment: "center",
    });
    addNotes(slide, [
      "商业化不是单独讨论价格，而是同时看访问、任务价值、留存与成本。",
      "三套数据系统分别回答用户价值、增长效率和单位经济。",
    ], sourceSubset(a));
  }

  // 9. Opportunity portfolio.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Opportunity portfolio", 9);
    addTitle(slide, "优先做高影响、高信心、可控投入的机会", "横轴：投入；纵轴：影响；气泡颜色：时间窗口");
    addRect(slide, { left: 80, top: 220, width: 790, height: 410 }, C.white, "rounded-2xl", C.line);
    addText(slide, "高影响", { left: 92, top: 230, width: 100, height: 24 }, { fontSize: 16, color: C.muted });
    addText(slide, "低投入", { left: 92, top: 592, width: 100, height: 24 }, { fontSize: 16, color: C.muted });
    addText(slide, "高投入", { left: 765, top: 592, width: 90, height: 24 }, { fontSize: 16, color: C.muted, alignment: "right" });
    addRect(slide, { left: 474, top: 240, width: 2, height: 350 }, C.line, "none");
    addRect(slide, { left: 115, top: 420, width: 720, height: 2 }, C.line, "none");
    const horizonColors = { Now: C.accent, Next: C.mint, Later: C.blue };
    const opportunities = a.opportunities.slice(0, 6);
    opportunities.forEach((item, index) => {
      const bubbleX = 115 + (item.effort / 10) * 670;
      const bubbleY = 570 - (item.impact / 10) * 300;
      const size = 46 + item.confidence * 4;
      addRect(slide, { left: bubbleX - size / 2, top: bubbleY - size / 2, width: size, height: size }, horizonColors[item.horizon] || C.blue, "rounded-2xl");
      addText(slide, String(index + 1), { left: bubbleX - 18, top: bubbleY - 15, width: 36, height: 30 }, { fontSize: 18, color: C.white, bold: true, alignment: "center" });
    });
    addRect(slide, { left: 920, top: 220, width: 296, height: 410 }, C.ink, "rounded-2xl");
    addText(slide, "机会清单", { left: 950, top: 250, width: 200, height: 34 }, { fontSize: 24, color: C.lime, bold: true });
    addFittedList(slide, opportunities.map((item) => item.title), { left: 950, top: 305, width: 230, height: 282 }, {
      fontSize: 20, minFontSize: 16, maxItems: 6, color: C.white, lineSpacing: 1.12,
    });
    addNotes(slide, [
      "先讲左上象限，再说明低信心机会需要怎样的证据实验。",
      "机会编号与下一页执行卡保持一致。",
    ], sourcesByIds(a, opportunities.flatMap((item) => item.evidenceIds || [])));
  }

  // 10. Opportunity execution cards: experiment, metric, owner.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Execution cards", 10);
    addTitle(slide, "机会只有绑定实验、指标和负责人，才不是愿望清单", "优先展示综合影响、信心与投入后的前三项机会");
    const headers = ["机会", "价值 / 风险", "最小实验", "成功标准", "负责人 / 窗口"];
    const widths = [220, 276, 288, 202, 150];
    let headerX = 72;
    headers.forEach((header, index) => {
      addRect(slide, { left: headerX, top: 226, width: widths[index], height: 44 }, C.ink, "none");
      addText(slide, header, { left: headerX + 12, top: 236, width: widths[index] - 24, height: 24 }, { fontSize: 17, color: C.white, bold: true });
      headerX += widths[index];
    });
    const ranked = [...a.opportunities].sort((left, right) => ((right.impact * right.confidence) / Math.max(1, right.effort)) - ((left.impact * left.confidence) / Math.max(1, left.effort))).slice(0, 3);
    ranked.forEach((item, rowIndex) => {
      const top = 270 + rowIndex * 112;
      const fill = rowIndex % 2 ? C.paper : C.white;
      const values = [item.title, `${item.value}\n风险：${item.risk}`, item.experiment, item.successCriteria, `${item.owner}\n${item.horizon}`];
      let cellX = 72;
      values.forEach((value, index) => {
        addRect(slide, { left: cellX, top, width: widths[index], height: 112 }, fill, "none", C.line);
        addFittedText(slide, value, { left: cellX + 12, top: top + 10, width: widths[index] - 24, height: 92 }, {
          fontSize: index === 0 ? 18 : 17,
          minFontSize: 16,
          bold: index === 0,
          lineSpacing: 1.1,
          maxLines: 5,
        });
        cellX += widths[index];
      });
    });
    addFittedText(slide, `资源约束：${ranked.map((item) => joined(item.resources, item.owner)).join("  /  ") || "待定义"}`, { left: 72, top: 624, width: 1136, height: 34 }, {
      fontSize: 17, minFontSize: 16, color: C.muted, maxLines: 2,
    });
    addNotes(slide, [
      "每项机会都要明确最小实验、成功标准、负责人和时间窗口。",
      "如果资源不满足，优先砍范围而不是模糊成功标准。",
    ], sourcesByIds(a, ranked.flatMap((item) => item.evidenceIds || [])));
  }

  // 11. Roadmap: sequence capability building, not a feature backlog.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Roadmap", 11);
    addTitle(slide, "路线图要按不确定性消除顺序推进", "Now 验证付费与服务线，Next 放大数据闭环，Later 建立平台生态");
    const columns = [["NOW · 0–8 周", a.roadmap.now, C.accent], ["NEXT · 2–6 月", a.roadmap.next, C.mint], ["LATER · 6 月+", a.roadmap.later, C.ink]];
    columns.forEach(([label, items, color], index) => {
      const columnX = 70 + index * 388;
      addRect(slide, { left: columnX, top: 230, width: 340, height: 382 }, C.white, "rounded-2xl", C.line);
      addRect(slide, { left: columnX, top: 230, width: 340, height: 68 }, color, "rounded-xl");
      addText(slide, label, { left: columnX + 26, top: 246, width: 288, height: 36 }, { fontSize: 22, color: C.white, bold: true });
      addFittedList(slide, items, { left: columnX + 28, top: 322, width: 284, height: 252 }, {
        fontSize: 21, minFontSize: 16, maxItems: 5, lineSpacing: 1.12,
      });
    });
    addNotes(slide, [
      "Now 阶段先消除企业付费、任务成功率和单位成本三类最大不确定性。",
      "Next 与 Later 只有在前一阶段指标达标后才放大。",
    ], sourceSubset(a));
  }

  // 12. Final decision summary: demand, scenario, service and money on one page.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.ink;
    const decisionHeadline = a.executiveSummary.verdict
      .split(/——|[。；]/u)[0]
      .replace(/^最值得投入的产品机会是/u, "结论：")
      .trim();
    addText(slide, "DECISION SUMMARY", { left: 72, top: 54, width: 280, height: 30 }, { fontSize: 16, color: C.lime, bold: true });
    addFittedText(slide, decisionHeadline, { left: 72, top: 104, width: 1136, height: 108 }, {
      fontSize: 44, minFontSize: 35, lineSpacing: 1.02, maxLines: 3, color: C.white, bold: true,
    });
    addRect(slide, { left: 72, top: 238, width: 1136, height: 278 }, C.white, "rounded-2xl");
    const summaryColumns = [
      ["需求", a.userNeeds.painPoints.slice(0, 3)],
      ["关键场景", a.userNeeds.scenarios.slice(0, 3).map((item) => item.name)],
      ["服务程度", [a.northStar.metric, ...a.northStar.guardrails.slice(0, 2)]],
      ["商业化", [`收入：${a.economics.model}`, `客单：${a.economics.arpu}`, `留存：${a.economics.retention}`]],
    ];
    summaryColumns.forEach(([label, items], index) => {
      const columnX = 72 + index * 284;
      if (index > 0) addRect(slide, { left: columnX, top: 254, width: 1, height: 246 }, C.line, "none");
      addText(slide, label, { left: columnX + 22, top: 260, width: 238, height: 34 }, { fontSize: 23, color: [C.accent, C.mint, C.blue, C.warning][index], bold: true });
      addFittedList(slide, items, { left: columnX + 22, top: 310, width: 238, height: 176 }, {
        fontSize: 18, minFontSize: 16, maxItems: 3, lineSpacing: 1.1,
      });
    });
    addRect(slide, { left: 72, top: 552, width: 1136, height: 92 }, C.accent, "rounded-2xl");
    addText(slide, "需要确认", { left: 104, top: 570, width: 160, height: 26 }, { fontSize: 18, color: C.white, bold: true });
    addFittedText(slide, a.meta.decisionQuestion, { left: 104, top: 600, width: 1068, height: 32 }, {
      fontSize: 27, minFontSize: 22, maxLines: 2, color: C.white, bold: true, lineSpacing: 1.05,
    });
    addText(slide, `证据 ${a.evidence.length} 条  ·  评分覆盖 ${a.audit.scoreEvidenceCoverage}%  ·  机会覆盖 ${a.audit.opportunityEvidenceCoverage}%`, { left: 72, top: 668, width: 760, height: 24 }, { fontSize: 16, color: "#AABCB4" });
    addNotes(slide, [
      "用这一页收口四件事：为什么买、在哪里用、服务要达到什么程度、如何形成收入。",
      "最后回到决策问题，明确会议要批准的投入与验证窗口。",
    ], sourceSubset(a));
  }

  const temp = path.join(os.tmpdir(), `ai-ca-${crypto.randomUUID()}.pptx`);
  try {
    const file = await PresentationFile.exportPptx(deck);
    await file.save(temp);
    return await normalizePptxTypography(await fs.readFile(temp));
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
    await fs.rm(`${temp}.inspect.ndjson`, { force: true }).catch(() => {});
  }
}

export async function buildPptx(rawAnalysis) {
  const a = normalizeAnalysis(rawAnalysis);
  let deck = Presentation.create({ slideSize: { width: PPT_W, height: PPT_H } });
  const focus = a.competitors[0] || {
    name: a.meta.product,
    role: "本品",
    strengths: [],
    weaknesses: [],
    coreJobs: [],
    fiveLayers: {},
    aiProfile: {},
  };
  const asList = (value, fallback = "待验证") => {
    const list = Array.isArray(value) ? value.filter(Boolean).map(String) : [];
    return list.length ? list : [fallback];
  };
  const short = (value, units = 36, fallback = "待验证") => conciseVisible(value, units, fallback);
  const joinShort = (items, maxItems = 3, units = 48) => short(asList(items).slice(0, maxItems).join("；"), units);
  const firstCompetitors = a.competitors.slice(0, 4);
  const auditByProduct = new Map((a.productExperience?.competitorAudits || [])
    .map((item) => [String(item.competitorName || "").trim().toLowerCase(), item]));
  const productAuditGroups = a.competitors.map((competitor, index) => {
    const matched = auditByProduct.get(String(competitor.name || "").trim().toLowerCase());
    if (matched) return matched;
    if (index === 0 && (a.productExperience?.interfaceAudit || []).length) {
      return {
        competitorName: competitor.name,
        role: competitor.role,
        designLogic: a.productExperience.designLogic,
        interactionLogic: a.productExperience.interactionLogic,
        interfaceAudit: a.productExperience.interfaceAudit,
      };
    }
    return {
      competitorName: competitor.name,
      role: competitor.role,
      designLogic: [],
      interactionLogic: [],
      interfaceAudit: [],
    };
  });
  const scenarios = a.userNeeds.scenarios.slice(0, 4);
  const guardrails = asList(a.northStar.guardrails);
  const ranked = [...a.opportunities]
    .sort((left, right) => ((right.impact * right.confidence) / Math.max(1, right.effort)) - ((left.impact * left.confidence) / Math.max(1, left.effort)))
    .slice(0, 3);
  const costPlan = [
    {
      phase: "验证版 · 0–8 周",
      team: "8–10 人 · 16–20 人月",
      budget: "100–200 万元",
      scope: "桌面任务闭环、企业试用、任务评测、成本看板",
      gate: "50 家试用；首任务与转付费可测",
      color: C.accent,
    },
    {
      phase: "产品化 · 2–6 月",
      team: "12–16 人 · 48–64 人月",
      budget: "300–650 万元",
      scope: "Teams 协作、移动派活、失败回流、企业后台",
      gate: "坐席翻倍；Top10 成功率提升 10 点",
      color: C.mint,
    },
    {
      phase: "规模化 · 6–12 月",
      team: "16–24 人 · 96–144 人月",
      budget: "600–1500 万元",
      scope: "专有云、行业方案、开放平台、售前交付体系",
      gate: "行业标杆形成；任务毛利转正",
      color: C.ink,
    },
  ];

  // 1. Cover.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.ink;
    addText(slide, "PRODUCT EXPERIENCE & COMPETITIVE ANALYSIS", { left: 72, top: 70, width: 560, height: 30 }, {
      fontSize: 16, color: C.lime, bold: true,
    });
    addFittedText(slide, a.meta.title || `${focus.name || a.meta.product} 竞品与产品体验分析`, { left: 72, top: 174, width: 860, height: 108 }, {
      fontSize: 56, color: C.white, bold: true, wrap: "none",
    });
    addFittedText(slide, "从真实使用界面、任务过程和失败恢复判断产品机会", { left: 72, top: 300, width: 820, height: 62 }, {
      fontSize: 28, minFontSize: 24, color: "#D8E5DF", maxLines: 2,
    });
    addRect(slide, { left: 980, top: 160, width: 190, height: 360 }, C.accent, "rounded-2xl");
    addText(slide, `${a.competitors.length}`, { left: 1015, top: 215, width: 120, height: 58 }, { fontSize: 44, color: C.white, bold: true, alignment: "center" });
    addText(slide, "分析对象", { left: 1015, top: 272, width: 120, height: 32 }, { fontSize: 19, color: C.white, bold: true, alignment: "center" });
    addText(slide, `${a.evidence.length}`, { left: 1015, top: 350, width: 120, height: 58 }, { fontSize: 44, color: C.white, bold: true, alignment: "center" });
    addText(slide, "证据条目", { left: 1015, top: 407, width: 120, height: 32 }, { fontSize: 19, color: C.white, bold: true, alignment: "center" });
    addRect(slide, { left: 72, top: 500, width: 820, height: 82 }, "#18352E", "rounded-xl");
    addText(slide, "本次需要回答", { left: 98, top: 517, width: 170, height: 24 }, { fontSize: 17, color: C.lime, bold: true });
    addFittedText(slide, a.meta.decisionQuestion, { left: 98, top: 546, width: 760, height: 28 }, { fontSize: 23, minFontSize: 20, color: C.white, bold: true, maxLines: 1 });
    addText(slide, `${a.meta.date}  |  ${a.meta.audience}  |  联网调研 ${a.research.searchCalls || 0} 次`, { left: 72, top: 648, width: 720, height: 24 }, { fontSize: 16, color: "#AABCB4" });
    addNotes(slide, [
      "这是一份基于真实使用界面的竞品分析，不是官网功能目录。",
      "全篇围绕用户怎样完成任务、哪里会卡住，以及这些差异怎样影响投入决策展开。",
    ], sourceSubset(a));
  }

  // 2. Investment thesis.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Executive conclusion", 2);
    addTitle(slide, a.executiveSummary?.verdict || `${focus.name}的机会来自真实任务闭环，而不是功能数量`, a.executiveSummary?.headline || "后续页面用真实使用过程逐项验证这条结论");
    addRect(slide, { left: 72, top: 228, width: 706, height: 392 }, C.white, "rounded-2xl", C.line);
    addText(slide, "为什么现在值得投入", { left: 104, top: 254, width: 300, height: 34 }, { fontSize: 24, bold: true });
    const summaryInsights = asList(a.executiveSummary?.insights, "需要继续从真实使用过程验证差异");
    const thesisEvidence = summaryInsights.slice(0, 4).map((value, index) => [["发现", "差异", "机会", "风险"][index], short(value, 54)]);
    thesisEvidence.forEach(([label, value], index) => {
      const top = 306 + index * 70;
      addText(slide, label, { left: 104, top, width: 78, height: 28 }, { fontSize: 18, color: index === 3 ? C.accent : C.mint, bold: true });
      addFittedText(slide, value, { left: 196, top, width: 534, height: 48 }, { fontSize: 18, minFontSize: 16, maxLines: 2, bold: index === 2 });
    });
    addRect(slide, { left: 820, top: 228, width: 388, height: 392 }, C.ink, "rounded-2xl");
    addText(slide, "下一步", { left: 858, top: 258, width: 180, height: 34 }, { fontSize: 24, color: C.lime, bold: true });
    addFittedText(slide, short(a.executiveSummary?.verdict, 72, "先补齐真实任务闭环，再验证收费"), { left: 858, top: 318, width: 310, height: 108 }, { fontSize: 27, minFontSize: 22, color: C.white, bold: true, maxLines: 4 });
    addFittedList(slide, asList(a.executiveSummary?.actions, "补齐关键使用过程").slice(0, 3), { left: 858, top: 458, width: 310, height: 126 }, { fontSize: 18, minFontSize: 16, maxItems: 3, color: C.white, numberColor: C.lime });
    addNotes(slide, [
      "本页只保留调研已经得到的结论、证据和下一步，不额外套入通用投资话术。",
      "后续页面用真实界面验证这些判断。",
    ], sourceSubset(a));
  }

  // 3. Demand.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Demand", 3);
    addTitle(slide, "用户真正付费，是为了把重复工作交出去", "价值来自节省时间、减少切换，并交付可验收结果");
    const needs = [
      ["重复劳动", a.userNeeds.painPoints?.[0] || "重复、多步骤任务占用大量时间", "把固定流程自动化"],
      ["执行断点", a.userNeeds.painPoints?.[1] || "AI 只能建议，不能操作文件与系统", "让 Agent 能读、能做、能交付"],
      ["协作断点", a.userNeeds.painPoints?.[2] || "多工具和多端切换导致流程断裂", "把任务、产物和团队放进同一空间"],
      ["成本不透明", a.userNeeds.painPoints?.[3] || "模型成本与价格难匹配", "按任务价值和成本透明计费"],
    ];
    needs.forEach(([label, pain, outcome], index) => {
      const top = 226 + index * 92;
      addText(slide, String(index + 1).padStart(2, "0"), { left: 74, top: top + 20, width: 44, height: 28 }, { fontSize: 17, color: C.mint, bold: true });
      addText(slide, label, { left: 132, top: top + 14, width: 160, height: 34 }, { fontSize: 24, bold: true });
      addFittedText(slide, short(pain, 48), { left: 306, top: top + 12, width: 480, height: 56 }, { fontSize: 18, minFontSize: 16, color: C.muted, maxLines: 2 });
      addText(slide, "→", { left: 808, top: top + 18, width: 40, height: 32 }, { fontSize: 26, color: C.accent, alignment: "center" });
      addFittedText(slide, outcome, { left: 872, top: top + 12, width: 320, height: 56 }, { fontSize: 20, minFontSize: 17, bold: true, maxLines: 2 });
      if (index < needs.length - 1) addRect(slide, { left: 72, top: top + 78, width: 1136, height: 1 }, C.line, "none");
    });
    addRect(slide, { left: 72, top: 610, width: 1136, height: 48 }, "#E6EEE9", "rounded-xl");
    addFittedText(slide, `核心用户：${a.userNeeds.personas.slice(0, 3).map((item) => item.name).join("、") || "知识工作者、开发者与企业团队"}`, { left: 96, top: 621, width: 1090, height: 26 }, { fontSize: 18, minFontSize: 16, color: C.mint, bold: true, maxLines: 1 });
    addNotes(slide, [
      "需求不从模型能力出发，而从用户愿意付钱消除的工作负担出发。",
      "四类需求分别对应自动化、执行、协作和计费能力。",
    ], sourceSubset(a));
  }

  // 4. Actual scenarios.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Actual scenarios", 4);
    addTitle(slide, `最值得验证的三类工作：${scenarios.map((item) => item.name).join("、") || "报告、研究与知识管理"}`, "每个场景都说清楚：用户为什么开始、让产品做什么、最后拿到什么");
    const headers = ["场景与触发", "实际执行功能", "交付结果", "最低验收线"];
    const widths = [240, 390, 286, 220];
    let hx = 72;
    headers.forEach((header, index) => {
      addRect(slide, { left: hx, top: 224, width: widths[index], height: 44 }, C.ink, "none");
      addText(slide, header, { left: hx + 14, top: 234, width: widths[index] - 28, height: 24 }, { fontSize: 17, color: C.white, bold: true });
      hx += widths[index];
    });
    const rows = scenarios.length ? scenarios : [{ name: "待补充", trigger: "待验证", task: "待验证", outcome: "待验证" }];
    rows.forEach((item, rowIndex) => {
      const top = 268 + rowIndex * 82;
      const fill = rowIndex % 2 ? C.paper : C.white;
      const values = [
        `${item.name}\n${short(item.trigger, 20)}`,
        short(item.task, 52),
        short(item.outcome, 40),
        `结果符合「${short(item.outcome, 24)}」；过程可查看，失败可继续`,
      ];
      let x = 72;
      values.forEach((value, index) => {
        addRect(slide, { left: x, top, width: widths[index], height: 82 }, fill, "none", C.line);
        addFittedText(slide, value, { left: x + 12, top: top + 10, width: widths[index] - 24, height: 62 }, { fontSize: index === 0 ? 18 : 17, minFontSize: 16, bold: index === 0, maxLines: 3, lineSpacing: 1.08 });
        x += widths[index];
      });
    });
    addText(slide, "场景优先级：先做高频、结果明确、可度量的任务；开放式创作放在后面", { left: 72, top: 620, width: 1136, height: 28 }, { fontSize: 18, color: C.mint, bold: true });
    addNotes(slide, [
      "场景页用于检验产品是否真的完成工作，而不是展示能力名词。",
      "PPT、数据和远程派活分别验证交付、隐私和多端协同。",
    ], sourcesByIds(a, scenarios.flatMap((item) => item.evidenceIds || [])));
  }

  // 5. Functional architecture.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Functional system", 5);
    addTitle(slide, "完整交付需要七层能力协同，而非单点模型", "任何一层失效，用户得到的都只是半成品");
    const layers = [
      ["入口", "桌面端、小程序、IM、定时任务"],
      ["理解", "文本、图片、文件与上下文解析"],
      ["规划", "任务拆解、子 Agent、模型路由"],
      ["工具", "本地文件、Office、MCP 与外部系统"],
      ["安全", "权限确认、沙箱、审计与数据驻留"],
      ["交付", "文档、PPTX、表格、代码与分享"],
      ["协作计费", "Teams、资产库、坐席、积分与加量包"],
    ];
    layers.forEach(([label, value], index) => {
      const x = 54 + index * 174;
      if (index < layers.length - 1) addText(slide, "→", { left: x + 146, top: 322, width: 28, height: 30 }, { fontSize: 22, color: C.muted, alignment: "center" });
      addRect(slide, { left: x, top: 246, width: 146, height: 190 }, index === 3 ? C.ink : C.white, "rounded-xl", index === 3 ? C.ink : C.line);
      addText(slide, String(index + 1).padStart(2, "0"), { left: x + 18, top: 264, width: 40, height: 24 }, { fontSize: 16, color: index === 3 ? C.lime : C.mint, bold: true });
      addText(slide, label, { left: x + 18, top: 298, width: 110, height: 34 }, { fontSize: 23, color: index === 3 ? C.white : C.ink, bold: true });
      addFittedText(slide, value, { left: x + 18, top: 346, width: 110, height: 68 }, { fontSize: 17, minFontSize: 16, color: index === 3 ? C.white : C.muted, maxLines: 4, lineSpacing: 1.08 });
    });
    addRect(slide, { left: 72, top: 476, width: 1136, height: 146 }, "#E6EEE9", "rounded-xl");
    addText(slide, "当前必须补强的三处连接", { left: 100, top: 500, width: 300, height: 32 }, { fontSize: 23, bold: true });
    const gaps = [
      ["工具 → 安全", "权限、沙箱和审计必须贯穿每次执行"],
      ["交付 → 协作", "产物必须进入项目、资产库和团队复用"],
      ["计费 → 成本", "积分扣减必须能回到每个任务的真实成本"],
    ];
    gaps.forEach(([label, value], index) => {
      const x = 100 + index * 360;
      addText(slide, label, { left: x, top: 548, width: 300, height: 26 }, { fontSize: 18, color: C.mint, bold: true });
      addFittedText(slide, value, { left: x, top: 578, width: 310, height: 32 }, { fontSize: 16, minFontSize: 16, maxLines: 2 });
    });
    addNotes(slide, [
      "七层能力把入口、执行、交付、协作和计费串成完整系统。",
      "优先补连接关系，不用继续增加零散功能。",
    ], sourceSubset(a));
  }

  // 6. Competitive reality.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Competitive reality", 6);
    addTitle(slide, `${focus.name} 的机会取决于生态与稳定交付`, "比较任务覆盖、执行深度、企业能力和收费基础");
    const headers = ["产品", "高价值任务", "执行深度", "企业与生态", "收费基础"];
    const widths = [150, 286, 230, 270, 200];
    let x = 72;
    headers.forEach((header, index) => {
      addRect(slide, { left: x, top: 224, width: widths[index], height: 44 }, C.ink, "none");
      addText(slide, header, { left: x + 12, top: 234, width: widths[index] - 24, height: 24 }, { fontSize: 17, color: C.white, bold: true });
      x += widths[index];
    });
    firstCompetitors.forEach((item, rowIndex) => {
      const top = 268 + rowIndex * 84;
      const fill = rowIndex % 2 ? C.paper : C.white;
      const values = [
        `${item.name}\n${item.role}`,
        joinShort(item.coreJobs, 2, 38),
        short(item.aiProfile?.quality || item.positioning, 34),
        short(item.aiProfile?.integration || item.businessModel, 38),
        short(item.pricing, 30),
      ];
      let cellX = 72;
      values.forEach((value, index) => {
        addRect(slide, { left: cellX, top, width: widths[index], height: 84 }, fill, "none", C.line);
        addFittedText(slide, value, { left: cellX + 12, top: top + 10, width: widths[index] - 24, height: 64 }, { fontSize: index === 0 ? 18 : 16, minFontSize: 16, bold: index === 0, maxLines: 4, lineSpacing: 1.06 });
        cellX += widths[index];
      });
    });
    addRect(slide, { left: 72, top: 618, width: 1136, height: 40 }, C.ink, "rounded-xl");
    addText(slide, "竞争结论：不靠再接一个模型取胜；靠本地执行、腾讯生态、企业治理和单位成本形成组合壁垒", { left: 96, top: 626, width: 1088, height: 24 }, { fontSize: 17, color: C.white, bold: true });
    addNotes(slide, [
      "竞争比较只保留与实际交付和商业化相关的四个维度。",
      "本品优势能否变现，取决于稳定性、企业治理与交付体系。",
    ], sourceSubset(a));
  }

  // 7. Service level.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Service level", 7);
    addTitle(slide, "企业采购先看可控性，再看模型聪明度", "服务线必须能写进验收标准和故障处理流程");
    const headers = ["服务维度", "当前能力", "最低验收线", "运营责任"];
    const widths = [170, 390, 396, 180];
    let x = 72;
    headers.forEach((header, index) => {
      addRect(slide, { left: x, top: 224, width: widths[index], height: 44 }, C.ink, "none");
      addText(slide, header, { left: x + 12, top: 234, width: widths[index] - 24, height: 24 }, { fontSize: 17, color: C.white, bold: true });
      x += widths[index];
    });
    const rows = [
      ["任务质量", `${focus.aiProfile?.quality || "任务能力待验证"}；${focus.aiProfile?.latency || "时延待验证"}`, `${short(a.northStar.metric, 30)}；${short(guardrails[0], 28)}`, "评测与模型团队"],
      ["可靠恢复", focus.aiProfile?.reliability || "待验证", "长任务可恢复；失败原因可分类；版本可回滚", "Agent 平台"],
      ["安全隐私", focus.aiProfile?.privacy || "待验证", "最小权限、沙箱隔离、审计日志、数据驻留可验证", "安全与专有云"],
      ["集成协作", focus.aiProfile?.integration || "待验证", "文档、IM、项目与资产库端到端打通", "企业产品"],
      ["成本计费", focus.aiProfile?.cost || "待验证", `${short(guardrails[1], 30)}；失败任务不应刚性扣费`, "商业化与财务"],
    ];
    rows.forEach((row, rowIndex) => {
      const top = 268 + rowIndex * 70;
      const fill = rowIndex % 2 ? C.paper : C.white;
      let cellX = 72;
      row.forEach((value, index) => {
        addRect(slide, { left: cellX, top, width: widths[index], height: 70 }, fill, "none", C.line);
        addFittedText(slide, short(value, index === 1 ? 42 : 38), { left: cellX + 12, top: top + 10, width: widths[index] - 24, height: 50 }, { fontSize: index === 0 ? 18 : 16, minFontSize: 16, bold: index === 0, maxLines: 3, lineSpacing: 1.06 });
        cellX += widths[index];
      });
    });
    addText(slide, "采购门槛 = 可用 + 可恢复 + 可审计 + 可控成本", { left: 72, top: 632, width: 1136, height: 28 }, { fontSize: 20, color: C.mint, bold: true, alignment: "center" });
    addNotes(slide, [
      "服务页把模型能力翻译成企业可采购的服务合同。",
      "质量、恢复、安全、集成和成本都必须有明确责任人。",
    ], sourceSubset(a));
  }

  // 8. Market timing.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Market timing", 8);
    addTitle(slide, "窗口期来自企业化，而不是个人端再补功能", "行业正在从内容生成转向任务交付与组织治理");
    const stages = ["技术验证", "个人工具", "任务 Agent", "团队协作", "企业平台", "生态市场"];
    stages.forEach((stage, index) => {
      const x = 70 + index * 194;
      const active = index === 2 || index === 3;
      if (index < stages.length - 1) addText(slide, "→", { left: x + 160, top: 297, width: 34, height: 30 }, { fontSize: 24, color: C.muted, alignment: "center" });
      addRect(slide, { left: x, top: 260, width: 160, height: active ? 112 : 82 }, active ? C.accent : C.white, "rounded-xl", active ? C.accent : C.line);
      addText(slide, stage, { left: x + 12, top: active ? 294 : 284, width: 136, height: 32 }, { fontSize: 20, color: active ? C.white : C.ink, bold: active, alignment: "center" });
    });
    const signals = [
      ["需求已经存在", short(a.market.sizeSignal, 55)],
      ["竞争正在集中", short(a.market.milestone, 55)],
      ["下一道门槛", "企业付费、任务质量、安全合规与行业方案将决定入口能否变成收入"],
    ];
    signals.forEach(([label, value], index) => {
      const x = 72 + index * 388;
      addText(slide, label, { left: x, top: 436, width: 250, height: 28 }, { fontSize: 19, color: C.mint, bold: true });
      addFittedText(slide, value, { left: x, top: 476, width: 340, height: 106 }, { fontSize: 20, minFontSize: 16, bold: true, maxLines: 5, lineSpacing: 1.08 });
    });
    addRect(slide, { left: 72, top: 614, width: 1136, height: 44 }, "#E6EEE9", "rounded-xl");
    addText(slide, "决策含义：2026 下半年优先抢企业样板与任务数据，不应把预算继续平均分配给个人端功能", { left: 96, top: 623, width: 1090, height: 26 }, { fontSize: 17, color: C.ink, bold: true });
    addNotes(slide, [
      "市场阶段只是背景，真正的窗口是企业样板和任务数据。",
      "个人规模不会自动转成收入，必须尽快验证企业付费和服务线。",
    ], sourceSubset(a));
  }

  // 9. Development cost.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Development cost", 9);
    addTitle(slide, "首期预算应投向交付底座，而非展示功能", "以下为规划估算；不含大规模渠道投放与长期模型预训练费用");
    costPlan.forEach((item, index) => {
      const x = 72 + index * 388;
      addRect(slide, { left: x, top: 226, width: 340, height: 272 }, C.white, "rounded-2xl", C.line);
      addRect(slide, { left: x, top: 226, width: 340, height: 58 }, item.color, "rounded-xl");
      addText(slide, item.phase, { left: x + 20, top: 241, width: 300, height: 30 }, { fontSize: 20, color: C.white, bold: true });
      addText(slide, item.team, { left: x + 22, top: 304, width: 296, height: 28 }, { fontSize: 17, color: C.muted, bold: true });
      addText(slide, item.budget, { left: x + 22, top: 342, width: 296, height: 42 }, { fontSize: 29, color: item.color, bold: true });
      addFittedText(slide, `范围：${item.scope}`, { left: x + 22, top: 398, width: 296, height: 46 }, { fontSize: 16, minFontSize: 16, maxLines: 2 });
      addFittedText(slide, `闸门：${item.gate}`, { left: x + 22, top: 448, width: 296, height: 42 }, { fontSize: 16, minFontSize: 16, color: C.muted, maxLines: 2 });
    });
    addText(slide, "产品化预算构成参考", { left: 72, top: 526, width: 260, height: 28 }, { fontSize: 20, bold: true });
    slide.charts.add("bar", {
      position: { left: 330, top: 518, width: 650, height: 152 },
      categories: ["Agent 运行时", "企业治理", "安全与专有云", "集成与运营"],
      series: [{ name: "预算占比", values: [30, 25, 25, 20], fill: C.mint }],
      hasLegend: false,
      dataLabels: { showValue: true, position: "outEnd", textStyle: { fontSize: 14, fill: C.ink } },
      xAxis: { minimumScale: 0, maximumScale: 35, majorUnit: 10, textStyle: { fontSize: 14, fill: C.muted } },
      yAxis: { textStyle: { fontSize: 15, fill: C.ink } },
    });
    addFittedText(slide, "预算闸门：每一阶段只在任务成功率、企业转付费和单位成本达到标准后追加", { left: 995, top: 546, width: 205, height: 88 }, { fontSize: 17, minFontSize: 16, color: C.accent, bold: true, maxLines: 4 });
    addNotes(slide, [
      "本页成本为规划估算，按团队规模、人月和基础设施费用给出区间。",
      "预算采用分阶段闸门，不建议一次性承诺全年规模。",
    ], []);
  }

  // 10. Pricing and economics.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Pricing model", 10);
    addTitle(slide, "企业版以坐席订阅打底，任务计量保护毛利", "定价同时解决低门槛试用、组织采购和高成本任务三类问题");
    const tiers = [
      ["免费入口", "0 元", "首任务激活与低成本试用"],
      ["个人订阅", "99 / 199 / 999 元/月", "按任务强度分层，积分额度控制成本"],
      ["企业 SaaS", "198 元/席/月", "团队协作、企业后台与共享积分池"],
      ["专有云", "316 元/席/月", "数据驻留、安全审计与交付服务"],
      ["任务加量", "1000 积分 50 元", "超额用量与高成本模型按量补充"],
    ];
    tiers.forEach(([label, price, role], index) => {
      const x = 72 + index * 228;
      addRect(slide, { left: x, top: 226, width: 204, height: 204 }, index === 2 ? C.ink : C.white, "rounded-xl", index === 2 ? C.ink : C.line);
      addText(slide, label, { left: x + 20, top: 248, width: 164, height: 28 }, { fontSize: 20, color: index === 2 ? C.lime : C.mint, bold: true });
      addFittedText(slide, price, { left: x + 20, top: 294, width: 164, height: 62 }, { fontSize: 25, minFontSize: 21, color: index === 2 ? C.white : C.ink, bold: true, maxLines: 2 });
      addFittedText(slide, role, { left: x + 20, top: 368, width: 164, height: 46 }, { fontSize: 16, minFontSize: 16, color: index === 2 ? C.white : C.muted, maxLines: 3 });
    });
    addRect(slide, { left: 72, top: 466, width: 700, height: 154 }, "#E6EEE9", "rounded-xl");
    addText(slide, "单位经济公式", { left: 100, top: 490, width: 220, height: 28 }, { fontSize: 21, bold: true });
    addText(slide, "任务毛利 = 任务收入 − 模型成本 − 工具与沙箱成本 − 交付成本", { left: 100, top: 536, width: 630, height: 36 }, { fontSize: 22, color: C.ink, bold: true });
    addText(slide, "护栏：单位任务积分成本下降 20%，任务成功率不得下降", { left: 100, top: 582, width: 630, height: 26 }, { fontSize: 17, color: C.mint, bold: true });
    addRect(slide, { left: 814, top: 466, width: 394, height: 154 }, C.ink, "rounded-xl");
    addText(slide, "商业化验证目标", { left: 844, top: 490, width: 260, height: 28 }, { fontSize: 21, color: C.lime, bold: true });
    addFittedList(slide, [
      "企业试用转付费超过 30%",
      "坐席扩容与周任务数同步增长",
      "积分消耗不成为留存断点",
    ], { left: 844, top: 532, width: 330, height: 76 }, { fontSize: 16, minFontSize: 16, maxItems: 3, color: C.white, numberColor: C.lime, itemGap: 2 });
    addNotes(slide, [
      "收费结构采用订阅、坐席、积分和专有云的组合。",
      "价格不是终点，关键是任务毛利和企业扩席是否同时成立。",
    ], sourceSubset(a));
  }

  // 11. Operating model.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Operating model", 11);
    addTitle(slide, "运营核心不是 DAU，而是任务成功率与扩席", "产品、模型、客户成功和生态运营围绕同一条任务闭环协作");
    const loops = [
      ["激活运营", "模板、首任务引导、示例任务、积分试用", a.dataSystems.user.metrics?.[0] || "首任务转化率", "增长产品"],
      ["质量运营", "失败任务归因、评测集、技能与模型回归", a.dataSystems.user.metrics?.[4] || "任务成功率", "模型与数据"],
      ["企业运营", "POC、管理员培训、周报、续费与扩席", a.dataSystems.revenue.metrics?.[1] || "企业坐席数", "客户成功"],
      ["生态运营", "Top 技能、开发者激励、审核与分成", "技能调用占比与第三方供给", "生态平台"],
    ];
    const headers = ["运营循环", "每周实际动作", "核心指标", "负责人"];
    const widths = [190, 506, 280, 160];
    let x = 72;
    headers.forEach((header, index) => {
      addRect(slide, { left: x, top: 224, width: widths[index], height: 44 }, C.ink, "none");
      addText(slide, header, { left: x + 12, top: 234, width: widths[index] - 24, height: 24 }, { fontSize: 17, color: C.white, bold: true });
      x += widths[index];
    });
    loops.forEach((row, rowIndex) => {
      const top = 268 + rowIndex * 82;
      const fill = rowIndex % 2 ? C.paper : C.white;
      let cellX = 72;
      row.forEach((value, index) => {
        addRect(slide, { left: cellX, top, width: widths[index], height: 82 }, fill, "none", C.line);
        addFittedText(slide, short(value, index === 1 ? 50 : 34), { left: cellX + 12, top: top + 12, width: widths[index] - 24, height: 58 }, { fontSize: index === 0 ? 19 : 17, minFontSize: 16, bold: index === 0, maxLines: 3, lineSpacing: 1.08 });
        cellX += widths[index];
      });
    });
    addRect(slide, { left: 72, top: 620, width: 1136, height: 42 }, "#E6EEE9", "rounded-xl");
    addText(slide, "共同北极星：周有效任务完成数；共同护栏：失败率、单位任务成本、安全事件与付费留存", { left: 96, top: 628, width: 1090, height: 26 }, { fontSize: 17, color: C.mint, bold: true });
    addNotes(slide, [
      "运营模型按激活、质量、企业客户和生态四条循环组织。",
      "所有团队共享任务成功和扩席目标，避免只追求流量。",
    ], sourceSubset(a));
  }

  // 12. Priority execution.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Priority execution", 12);
    addTitle(slide, "先做三件能验证收入与壁垒的事", "企业付费、任务数据和单位成本必须同步验证");
    ranked.forEach((item, index) => {
      const x = 72 + index * 388;
      addRect(slide, { left: x, top: 226, width: 340, height: 392 }, C.white, "rounded-2xl", C.line);
      addText(slide, String(index + 1).padStart(2, "0"), { left: x + 22, top: 248, width: 46, height: 28 }, { fontSize: 17, color: C.mint, bold: true });
      addFittedText(slide, short(item.title, 30), { left: x + 22, top: 286, width: 296, height: 68 }, { fontSize: 23, minFontSize: 19, bold: true, maxLines: 3 });
      addText(slide, "最小实验", { left: x + 22, top: 374, width: 120, height: 24 }, { fontSize: 17, color: C.accent, bold: true });
      addFittedText(slide, short(item.experiment, 46), { left: x + 22, top: 406, width: 296, height: 68 }, { fontSize: 16, minFontSize: 16, maxLines: 4 });
      addText(slide, "成功标准", { left: x + 22, top: 492, width: 120, height: 24 }, { fontSize: 17, color: C.mint, bold: true });
      const successCopy = short(item.successCriteria, 38).replace(/^3\s*个月/u, "三个月").replace(/^6\s*个月/u, "六个月");
      addFittedText(slide, successCopy, { left: x + 22, top: 524, width: 296, height: 44 }, { fontSize: 16, minFontSize: 16, bold: true, maxLines: 2 });
      addFittedText(slide, `${short(item.owner, 22)} · ${item.horizon}`, { left: x + 22, top: 584, width: 296, height: 24 }, { fontSize: 16, minFontSize: 16, color: C.muted, maxLines: 1 });
    });
    addNotes(slide, [
      "优先级不是按功能热度，而是按影响、信心和投入综合排序。",
      "三项工作分别验证收入、数据壁垒与任务毛利。",
    ], sourcesByIds(a, ranked.flatMap((item) => item.evidenceIds || [])));
  }

  // 13. Roadmap and prospects.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Roadmap & outlook", 13);
    addTitle(slide, "未来三年从工具、到团队、再到 Agent 平台", "先建立可收费服务，再放大数据飞轮与第三方供给");
    const horizons = [
      ["现在 · 工具可交付", a.roadmap.now, "验证企业付费与任务成本", C.accent],
      ["下一步 · 团队可治理", a.roadmap.next, "形成数据飞轮与行业样板", C.mint],
      ["未来 · 平台可扩张", a.roadmap.later, "开放 API、技能市场和 Agent 治理", C.ink],
    ];
    horizons.forEach(([label, items, outcome, color], index) => {
      const x = 72 + index * 388;
      if (index < horizons.length - 1) addText(slide, "→", { left: x + 342, top: 390, width: 46, height: 38 }, { fontSize: 28, color: C.muted, alignment: "center" });
      addRect(slide, { left: x, top: 226, width: 340, height: 392 }, C.white, "rounded-2xl", C.line);
      addRect(slide, { left: x, top: 226, width: 340, height: 64 }, color, "rounded-xl");
      addText(slide, label, { left: x + 24, top: 242, width: 292, height: 32 }, { fontSize: 21, color: C.white, bold: true });
      addFittedList(slide, asList(items).slice(0, 3).map((item) => short(item, 28)), { left: x + 24, top: 320, width: 292, height: 188 }, { fontSize: 18, minFontSize: 16, maxItems: 3, lineSpacing: 1.1 });
      addRect(slide, { left: x + 20, top: 532, width: 300, height: 62 }, "#E6EEE9", "rounded-xl");
      addFittedText(slide, outcome, { left: x + 36, top: 548, width: 268, height: 34 }, { fontSize: 17, minFontSize: 16, color: C.mint, bold: true, alignment: "center", maxLines: 2 });
    });
    addNotes(slide, [
      "路线图按能力和商业不确定性递进，而不是按功能堆积。",
      "长期前景来自平台、生态和组织级数据壁垒。",
    ], sourceSubset(a));
  }

  // 14. Annotated interface evidence.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Interface evidence", 14);
    addTitle(slide, "先看真实使用界面，再判断产品能力", "官网宣传不计入证据；每个产品继续展开进入、执行与交付过程");
    const leadGroup = productAuditGroups.find((group) => group.interfaceAudit?.some((item) => item.imagePath || item.imageUrl)) || productAuditGroups[0];
    const audits = Array.isArray(leadGroup?.interfaceAudit) ? leadGroup.interfaceAudit.slice(0, 3) : [];
    const imageAudit = audits.find((item) => item.imagePath || item.imageUrl);
    const interfaceImage = imageAudit ? await loadInterfaceImage(imageAudit) : null;
    if (interfaceImage) {
      addPptImage(slide, interfaceImage, { left: 72, top: 220, width: 660, height: 410 }, `界面证据：${leadGroup.competitorName} · ${imageAudit.screen}`);
      addRect(slide, { left: 88, top: 236, width: 250, height: 36 }, C.ink, "rounded-xl");
      addFittedText(slide, `${leadGroup.competitorName} · ${imageAudit.usageStage}`, { left: 104, top: 244, width: 218, height: 22 }, { fontSize: 16, minFontSize: 16, color: C.white, bold: true, maxLines: 1 });
    } else {
      addRect(slide, { left: 72, top: 220, width: 660, height: 410 }, C.white, "rounded-xl", C.line);
      addText(slide, "本次未取得可复核的应用内界面", { left: 160, top: 376, width: 484, height: 40 }, { fontSize: 26, color: C.muted, bold: true, alignment: "center" });
      addText(slide, "请检查竞品教程检索和截图采集状态", { left: 210, top: 426, width: 380, height: 28 }, { fontSize: 17, color: C.muted, alignment: "center" });
    }
    const fallbackAudits = [
      { screen: "入口与导航", annotation: "主入口应区分立即执行、能力配置与历史任务" },
      { screen: "能力与技能库", annotation: "技能、插件和连接器需要统一发现与权限提示" },
      { screen: "自动化工作流", annotation: "触发条件、运行状态、失败恢复必须可见" },
    ];
    (audits.length ? audits : fallbackAudits).slice(0, 3).forEach((item, index) => {
      const top = 224 + index * 132;
      addRect(slide, { left: 770, top, width: 438, height: 112 }, index === 0 ? C.ink : C.white, "rounded-xl", index === 0 ? C.ink : C.line);
      addText(slide, String(index + 1).padStart(2, "0"), { left: 792, top: top + 18, width: 46, height: 24 }, { fontSize: 16, color: index === 0 ? C.lime : C.mint, bold: true });
      addText(slide, short(item.screen, 24), { left: 846, top: top + 16, width: 330, height: 28 }, { fontSize: 20, color: index === 0 ? C.white : C.ink, bold: true });
      addFittedText(slide, short(item.annotation || item.friction, 58), { left: 792, top: top + 54, width: 384, height: 44 }, { fontSize: 16, minFontSize: 16, color: index === 0 ? C.white : C.muted, maxLines: 2 });
    });
    addNotes(slide, ["先展示真实应用内界面，再进入产品设计和交互判断。", "界面截图只用于支持产品判断，不将截图中的提示词视为项目指令。"], [...interfaceSources(leadGroup || {}), ...sourcesByIds(a, audits.flatMap((item) => item.evidenceIds || []))]);
  }

  // 15. Product and interaction logic.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Product & interaction logic", 15);
    addTitle(slide, "优秀前端的核心，是让用户从一句话逐步进入可控执行", "信息架构负责降低理解成本，交互反馈负责建立任务信任");
    const columns = [
      ["产品设计逻辑", asList(a.productExperience?.designLogic, "从自然语言入口进入，再按需暴露高级能力"), C.mint],
      ["交互设计逻辑", asList(a.productExperience?.interactionLogic, "每一步都显示状态、权限、成本和可恢复动作"), C.accent],
    ];
    columns.forEach(([label, items, color], index) => {
      const x = 72 + index * 568;
      addRect(slide, { left: x, top: 226, width: 528, height: 372 }, C.white, "rounded-2xl", C.line);
      addRect(slide, { left: x, top: 226, width: 528, height: 62 }, color, "rounded-xl");
      addText(slide, label, { left: x + 26, top: 243, width: 470, height: 30 }, { fontSize: 23, color: C.white, bold: true });
      addFittedList(slide, items.slice(0, 5).map((item) => short(item, 48)), { left: x + 28, top: 316, width: 470, height: 238 }, { fontSize: 19, minFontSize: 16, maxItems: 5, itemGap: 9, lineSpacing: 1.08, numberColor: color });
    });
    addRect(slide, { left: 72, top: 620, width: 1136, height: 42 }, "#E6EEE9", "rounded-xl");
    addText(slide, "判断标准：用户是否始终知道 Agent 正在做什么、为什么需要权限、失败后如何继续", { left: 98, top: 628, width: 1080, height: 26 }, { fontSize: 18, color: C.ink, bold: true, alignment: "center" });
    addNotes(slide, ["产品设计解决能力组织问题，交互设计解决执行信任问题。", "两者共同决定激活、任务成功与长期留存。"], sourceSubset(a));
  }

  // 16. User swimlane.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "User swimlane", 16);
    addTitle(slide, "一次任务交付横跨用户、前端、Agent、运营和数据", "任何一条泳道缺失，都会把智能能力变成不可运营的黑箱");
    const lanes = [
      ["用户", "user", C.accent], ["前端", "frontend", C.mint], ["Agent", "agent", C.ink], ["运营", "operations", C.blue], ["数据", "data", C.warning],
    ];
    const stages = (a.productExperience?.swimlanes || []).slice(0, 5);
    const fallback = [
      { stage: "发起", user: "描述目标", frontend: "解析并确认", agent: "拆解任务", operations: "提供模板", data: "创建 task" },
      { stage: "授权", user: "确认范围", frontend: "展示权限", agent: "校验工具", operations: "执行策略", data: "记录 consent" },
      { stage: "执行", user: "观察进度", frontend: "实时状态", agent: "调用技能", operations: "异常告警", data: "写入 run/event" },
      { stage: "交付", user: "验收结果", frontend: "预览与修订", agent: "生成产物", operations: "质量抽检", data: "保存 artifact" },
      { stage: "复用", user: "再次运行", frontend: "保存为模板", agent: "复用上下文", operations: "推荐技能", data: "更新 metric" },
    ];
    const rows = stages.length ? stages : fallback;
    const stageW = 132;
    const cellW = (1136 - stageW) / rows.length;
    addRect(slide, { left: 72, top: 218, width: stageW, height: 46 }, C.ink, "none");
    addText(slide, "泳道 / 阶段", { left: 84, top: 230, width: stageW - 24, height: 22 }, { fontSize: 16, color: C.white, bold: true });
    rows.forEach((row, index) => {
      const x = 72 + stageW + index * cellW;
      addRect(slide, { left: x, top: 218, width: cellW, height: 46 }, C.ink, "none", C.paper);
      addText(slide, short(row.stage, 14), { left: x + 8, top: 230, width: cellW - 16, height: 22 }, { fontSize: 16, color: C.white, bold: true, alignment: "center" });
    });
    lanes.forEach(([label, key, color], laneIndex) => {
      const top = 264 + laneIndex * 72;
      addRect(slide, { left: 72, top, width: stageW, height: 72 }, color, "none", C.paper);
      addText(slide, label, { left: 84, top: top + 23, width: stageW - 24, height: 28 }, { fontSize: 19, color: C.white, bold: true });
      rows.forEach((row, index) => {
        const x = 72 + stageW + index * cellW;
        addRect(slide, { left: x, top, width: cellW, height: 72 }, laneIndex % 2 ? C.paper : C.white, "none", C.line);
        addFittedText(slide, short(row[key], 28), { left: x + 8, top: top + 10, width: cellW - 16, height: 52 }, { fontSize: 15, minFontSize: 14, maxLines: 3, alignment: "center", verticalAlignment: "middle" });
      });
    });
    addNotes(slide, ["泳道把体验问题转成跨团队责任边界。", "每个阶段都对应可观测状态和数据写入。"], sourceSubset(a));
  }

  // 17. Tracking and data model.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Tracking & data model", 17);
    addTitle(slide, "埋点回答产品问题，数据库保证任务可恢复与可审计", "事件、实体和指标必须围绕同一个 task_id 串联");
    const tracking = (a.productExperience?.trackingPlan || []).slice(0, 5);
    const fallbackTracking = [
      { event: "task_created", metric: "任务发起率", decision: "入口与模板是否有效" },
      { event: "permission_confirmed", metric: "授权转化率", decision: "权限说明是否清晰" },
      { event: "task_run_completed", metric: "任务成功率", decision: "技能与模型质量" },
      { event: "artifact_accepted", metric: "结果验收率", decision: "交付是否解决任务" },
      { event: "task_reused", metric: "复用与留存", decision: "是否形成稳定工作流" },
    ];
    const eventRows = tracking.length ? tracking : fallbackTracking;
    addRect(slide, { left: 72, top: 222, width: 560, height: 398 }, C.white, "rounded-xl", C.line);
    addText(slide, "关键埋点字典", { left: 98, top: 246, width: 260, height: 30 }, { fontSize: 23, color: C.mint, bold: true });
    eventRows.forEach((item, index) => {
      const top = 294 + index * 60;
      addText(slide, short(item.event, 26), { left: 98, top, width: 210, height: 24 }, { fontSize: 16, color: C.ink, bold: true, fontFamily: "Microsoft YaHei" });
      addFittedText(slide, short(item.metric, 22), { left: 316, top, width: 116, height: 38 }, { fontSize: 15, minFontSize: 14, color: C.accent, bold: true, maxLines: 2 });
      addFittedText(slide, short(item.decision, 34), { left: 440, top, width: 164, height: 38 }, { fontSize: 15, minFontSize: 14, color: C.muted, maxLines: 2 });
      if (index < eventRows.length - 1) addRect(slide, { left: 98, top: top + 47, width: 506, height: 1 }, C.line, "none");
    });
    addRect(slide, { left: 662, top: 222, width: 546, height: 398 }, C.ink, "rounded-xl");
    addText(slide, "最小数据库实体", { left: 690, top: 246, width: 260, height: 30 }, { fontSize: 23, color: C.lime, bold: true });
    const entities = (a.productExperience?.dataModel?.entities || []).slice(0, 6);
    const fallbackEntities = [
      { name: "workspace", purpose: "组织与权限边界", relations: ["has users / tasks"] },
      { name: "task", purpose: "目标、状态与成本主表", relations: ["has runs / artifacts"] },
      { name: "task_run", purpose: "每次执行与恢复点", relations: ["has events"] },
      { name: "skill", purpose: "能力版本与权限声明", relations: ["used by runs"] },
      { name: "artifact", purpose: "交付物与验收状态", relations: ["belongs to task"] },
      { name: "event", purpose: "行为与运行审计", relations: ["links user/task/run"] },
    ];
    (entities.length ? entities : fallbackEntities).forEach((item, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = 690 + col * 246;
      const top = 298 + row * 96;
      addRect(slide, { left: x, top, width: 220, height: 74 }, "#18352E", "rounded-xl", "#35554C");
      addText(slide, short(item.name, 24), { left: x + 14, top: top + 10, width: 192, height: 22 }, { fontSize: 16, color: C.lime, bold: true });
      addFittedText(slide, short(item.purpose, 30), { left: x + 14, top: top + 36, width: 192, height: 30 }, { fontSize: 14, minFontSize: 13, color: C.white, maxLines: 2 });
    });
    addText(slide, "数据原则：租户隔离 · 事件不可变 · 运行可回放 · 敏感字段分级留存", { left: 690, top: 590, width: 490, height: 22 }, { fontSize: 15, color: C.white, bold: true, alignment: "center" });
    addNotes(slide, ["埋点不是日志清单，而是每个产品判断的测量契约。", "数据模型以任务为主轴，支持恢复、计费、审计和质量回归。"], sourceSubset(a));
  }

  // 18. Horizontal UI focus comparison.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "UI focus comparison", 18);
    addTitle(slide, "同一件工作，三个产品让用户走了三条不同的路", "比较从哪里开始、怎么做、怎样知道进度、卡住后怎么办，以及最后怎样拿到结果");
    const comparison = a.productExperience?.comparison || {};
    const products = [...new Set((comparison.cells || []).map((item) => item.product))].slice(0, 4);
    const dimensions = (comparison.dimensions || []).slice(0, 6);
    const cellMap = new Map((comparison.cells || []).map((item) => [`${item.dimension}::${item.product}`, item]));
    const names = products.length ? products : firstCompetitors.map((item) => item.name);
    const dims = dimensions.length ? dimensions : ["入口对象", "发起与配置", "执行反馈", "失败恢复", "结果交付", "权限治理"];
    const colW = Math.min(240, Math.floor(900 / Math.max(1, names.length)));
    const rowH = 60;
    addRect(slide, { left: 72, top: 210, width: 1136, height: 48 + dims.length * rowH }, C.white, "rounded-xl", C.line);
    addRect(slide, { left: 72, top: 210, width: 220, height: 48 }, C.ink, "none");
    addText(slide, "用户任务", { left: 88, top: 223, width: 188, height: 24 }, { fontSize: 16, color: C.white, bold: true });
    names.forEach((name, index) => {
      addRect(slide, { left: 292 + index * colW, top: 210, width: colW, height: 48 }, index % 2 ? C.mint : C.accent, "none");
      addFittedText(slide, short(name, 16), { left: 300 + index * colW, top: 222, width: colW - 16, height: 24 }, { fontSize: 16, minFontSize: 14, color: C.white, bold: true, maxLines: 1, alignment: "center" });
    });
    dims.forEach((dimension, row) => {
      const top = 258 + row * rowH;
      addFittedText(slide, short(dimension, 14), { left: 88, top: top + 15, width: 188, height: 30 }, { fontSize: 16, minFontSize: 14, color: C.mint, bold: true, maxLines: 2 });
      names.forEach((name, index) => {
        const cell = cellMap.get(`${dimension}::${name}`) || {};
        addFittedText(slide, short(cell.focus || cell.note || "待验证", 34), { left: 300 + index * colW, top: top + 7, width: colW - 16, height: 46 }, { fontSize: 13, minFontSize: 11, maxLines: 4, alignment: "left", lineSpacing: 1.02 });
      });
    });
    addNotes(slide, ["每个格子都回答用户实际经历了什么，不再复述产品定位。", "缺少失败、权限或结果页证据时明确写未核验，不靠猜测补齐。"], sourceSubset(a));
  }

  // 19. Backend delivery from UI.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Backend delivery", 19);
    const backend = a.productExperience?.backendDelivery || {};
    addTitle(slide, "从界面状态倒推给后端的最小交付口径", short(backend.summary, 42, "先交付可恢复的任务对象，再补连接器与导出"));
    const apis = (backend.apis || []).slice(0, 4);
    const jobs = (backend.jobs || []).slice(0, 3);
    addRect(slide, { left: 72, top: 222, width: 560, height: 398 }, C.white, "rounded-xl", C.line);
    addText(slide, "API", { left: 98, top: 246, width: 160, height: 28 }, { fontSize: 22, color: C.mint, bold: true });
    (apis.length ? apis : [{ method: "POST", path: "/api/tasks", purpose: "创建任务", payload: "goal, workspace_id" }]).forEach((item, index) => {
      const top = 292 + index * 72;
      addText(slide, short(`${item.method} ${item.path}`, 28), { left: 98, top, width: 500, height: 24 }, { fontSize: 16, color: C.accent, bold: true });
      addFittedText(slide, short(`${item.purpose}｜${item.payload}`, 40), { left: 98, top: top + 28, width: 500, height: 32 }, { fontSize: 15, minFontSize: 14, color: C.muted, maxLines: 2 });
    });
    addRect(slide, { left: 662, top: 222, width: 546, height: 190 }, C.ink, "rounded-xl");
    addText(slide, "异步任务", { left: 690, top: 244, width: 200, height: 28 }, { fontSize: 22, color: C.lime, bold: true });
    (jobs.length ? jobs : [{ name: "run_task", trigger: "task.created", writes: "task_run, artifact" }]).forEach((item, index) => {
      addFittedText(slide, short(`${item.name} ← ${item.trigger} → ${item.writes}`, 36), { left: 690, top: 286 + index * 36, width: 490, height: 30 }, { fontSize: 16, minFontSize: 14, color: C.white, maxLines: 1 });
    });
    addRect(slide, { left: 662, top: 430, width: 546, height: 190 }, C.white, "rounded-xl", C.line);
    addText(slide, "权限与验收", { left: 690, top: 452, width: 220, height: 28 }, { fontSize: 22, color: C.mint, bold: true });
    addFittedList(slide, asList([...(backend.permissions || []).slice(0, 2), ...(backend.acceptance || []).slice(0, 2)], "失败可恢复且可审计"), { left: 690, top: 490, width: 490, height: 110 }, { fontSize: 16, minFontSize: 14, maxItems: 4 });
    addNotes(slide, ["后端交付以界面状态为验收标准，而不是先画一张无限接口清单。", "任务、运行、产物和权限必须能从泳道回推。"], sourceSubset(a));
  }

  // 20. Final decision summary.
  {
    const slide = deck.slides.add();
    slide.background.fill = C.ink;
    addText(slide, "DECISION SUMMARY", { left: 72, top: 42, width: 280, height: 28 }, { fontSize: 16, color: C.lime, bold: true });
    addFittedText(slide, short(a.executiveSummary?.verdict, 70, "先补齐用户完成任务的关键断点，再验证付费"), { left: 72, top: 86, width: 1136, height: 62 }, { fontSize: 38, minFontSize: 30, color: C.white, bold: true, maxLines: 2 });
    const fromUi = a.productExperience?.businessFromUi || {};
    const scenarios = (a.userNeeds?.scenarios || []).slice(0, 3).map((item) => item.name).join("；") || "待验证";
    const expensiveWork = ranked.filter((item) => Number(item.effort) >= 7).slice(0, 2).map((item) => `${item.title}（投入 ${item.effort}/10）`);
    const costSummary = [...expensiveWork, ...(fromUi.costDrivers || []).slice(0, 2)].join("；") || "研发投入与运行成本待进一步估算";
    const summary = [
      ["需求", (fromUi.demand || []).join("；") || (a.userNeeds?.painPoints || []).slice(0, 3).join("；") || "待验证"],
      ["核心场景", scenarios],
      ["界面收费点", (fromUi.monetizationSurfaces || []).join("；") || a.economics?.model || "待从席位/额度入口验证"],
      ["开发与运行成本", costSummary],
      ["运营闭环", (fromUi.operatingLoops || []).join("；") || a.economics?.retention || "待验证"],
      ["发展前景", fromUi.outlook || "个人工具 → 团队 Agent → 企业平台"],
    ];
    summary.forEach(([label, value], index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = 72 + col * 388;
      const top = 190 + row * 170;
      addRect(slide, { left: x, top, width: 340, height: 140 }, C.white, "rounded-xl");
      addText(slide, label, { left: x + 22, top: top + 18, width: 160, height: 28 }, { fontSize: 21, color: [C.accent, C.mint, C.blue, C.warning, C.mint, C.accent][index], bold: true });
      addFittedText(slide, value, { left: x + 22, top: top + 56, width: 296, height: 66 }, { fontSize: 17, minFontSize: 16, maxLines: 4, lineSpacing: 1.08 });
    });
    addRect(slide, { left: 72, top: 558, width: 1136, height: 90 }, C.accent, "rounded-2xl");
    addText(slide, "需要确认", { left: 102, top: 575, width: 150, height: 24 }, { fontSize: 17, color: C.white, bold: true });
    addFittedText(slide, a.meta.decisionQuestion, { left: 102, top: 606, width: 1068, height: 30 }, { fontSize: 22, minFontSize: 18, color: C.white, bold: true, maxLines: 1 });
    addText(slide, `证据 ${a.evidence.length} 条  ·  评分覆盖 ${a.audit.scoreEvidenceCoverage}%  ·  机会覆盖 ${a.audit.opportunityEvidenceCoverage}%`, { left: 72, top: 674, width: 760, height: 20 }, { fontSize: 15, color: "#AABCB4" });
    addNotes(slide, [
      "最后一页同时回答需求、场景、服务、成本、收费运营和未来前景。",
      "会议需要批准的是验证预算和追加投入闸门，而不是无限期产品路线。",
    ], sourceSubset(a));
  }

  // Product-by-product application UI evidence. These slides are inserted into the
  // narrative before product and interaction conclusions during final reordering.
  const productEvidenceSlideIndexes = [];
  for (const [productIndex, group] of productAuditGroups.entries()) {
    const slide = deck.slides.add();
    productEvidenceSlideIndexes.push(deck.slides.count - 1);
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Application UI evidence", 21 + productIndex);
    addTitle(slide, `${short(group.competitorName, 25)}：真实使用流程与界面证据`, `${group.role || "竞品"} · 只采用应用内界面、官方教程或可信实操视频`);
    const audits = (group.interfaceAudit || []).slice(0, 3);
    const screens = Array.from({ length: 3 }, (_value, index) => audits[index] || null);
    for (const [screenIndex, audit] of screens.entries()) {
      const x = 72 + screenIndex * 388;
      addRect(slide, { left: x, top: 206, width: 340, height: 412 }, C.white, "rounded-xl", C.line);
      const imagePosition = { left: x + 12, top: 216, width: 316, height: 128 };
      const image = audit ? await loadInterfaceImage(audit) : null;
      if (image) {
        addPptImage(slide, image, imagePosition, `${group.competitorName} · ${audit.screen}`);
      } else {
        addRect(slide, imagePosition, "#EEF0EB", "rounded-xl", C.line);
        addText(slide, audit ? "截图读取失败" : "该阶段缺少界面证据", { left: x + 32, top: 258, width: 276, height: 30 }, { fontSize: 18, color: C.muted, bold: true, alignment: "center" });
        addFittedText(slide, audit?.sourceType || "需要继续检索官方教程或实操视频", { left: x + 32, top: 294, width: 276, height: 34 }, { fontSize: 14, minFontSize: 13, color: C.muted, alignment: "center", maxLines: 2 });
      }
      addText(slide, String(screenIndex + 1).padStart(2, "0"), { left: x + 22, top: 352, width: 42, height: 24 }, { fontSize: 16, color: C.mint, bold: true });
      addFittedText(slide, audit?.screen || ["进入与发起", "执行与状态", "交付与治理"][screenIndex], { left: x + 70, top: 348, width: 248, height: 28 }, { fontSize: 18, minFontSize: 15, bold: true, maxLines: 1 });
      const facts = audit ? [
        ["阶段", audit.usageStage],
        ["主操作", audit.primaryAction],
        ["系统反馈", audit.feedback],
        ["风险", audit.friction],
      ] : [
        ["阶段", ["进入/发起", "执行", "交付/治理"][screenIndex]],
        ["主操作", "待取得真实应用界面后判断"],
        ["系统反馈", "证据不足，暂不推断"],
        ["风险", "无法验证实际使用过程"],
      ];
      facts.forEach(([label, value], factIndex) => {
        const top = 380 + factIndex * 58;
        addText(slide, label, { left: x + 18, top, width: 76, height: 20 }, { fontSize: 13, color: factIndex === 3 ? C.accent : C.mint, bold: true });
        addFittedText(slide, value, { left: x + 96, top, width: 228, height: 54 }, { fontSize: 13, minFontSize: 12, color: C.ink, maxLines: 3, lineSpacing: 1.08 });
      });
    }
    const allScreens = group.interfaceAudit || [];
    const firstScreen = allScreens.find((item) => /进入|发起/u.test(item.usageStage || "")) || allScreens[0];
    const runScreen = allScreens.find((item) => /执行/u.test(item.usageStage || ""));
    const resultScreen = allScreens.find((item) => /交付/u.test(item.usageStage || ""));
    const plainConclusion = `${group.competitorName}先让用户${firstScreen?.primaryAction || "发起任务"}；${runScreen ? `运行时${runScreen.feedback}` : "运行过程仍缺界面证据"}；${resultScreen ? `完成后${resultScreen.feedback}` : "结果怎样验收仍待核验"}。`;
    addRect(slide, { left: 72, top: 626, width: 1136, height: 58 }, C.ink, "rounded-xl");
    addFittedText(slide, `一句话看懂：${plainConclusion}`, { left: 96, top: 634, width: 1088, height: 42 }, { fontSize: 16, minFontSize: 14, color: C.white, bold: true, maxLines: 2, lineSpacing: 1.08 });
    addNotes(slide, [
      `本页只分析 ${group.competitorName} 的真实应用使用过程，不使用官网首页或宣传图代替。`,
      "三个证据位分别覆盖进入或发起、执行状态、交付或治理；缺失项明确标为证据不足。",
    ], [...interfaceSources(group), ...sourcesByIds(a, audits.flatMap((item) => item.evidenceIds || []))]);
  }

  // Scenario value by product.
  const scenarioValueSlideIndex = deck.slides.count;
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Scenario value", 24);
    addTitle(slide, "三个产品最有价值的工作场景并不相同", "比较它们最适合替用户完成什么工作，以及哪些场景会显得太重或能力不足");
    productAuditGroups.slice(0, 3).forEach((group, index) => {
      const x = 64 + index * 384;
      const profile = group.scenarioValue || {};
      const scenarios = (profile.scenarios || []).slice(0, 3);
      addRect(slide, { left: x, top: 214, width: 352, height: 420 }, index === 0 ? C.ink : C.white, "rounded-xl", index === 0 ? C.ink : C.line);
      addText(slide, group.competitorName, { left: x + 20, top: 234, width: 312, height: 26 }, { fontSize: 18, color: index === 0 ? C.lime : C.mint, bold: true });
      addFittedText(slide, profile.bestScene || "最佳场景待验证", { left: x + 20, top: 276, width: 312, height: 78 }, { fontSize: 21, minFontSize: 17, color: index === 0 ? C.white : C.ink, bold: true, maxLines: 4 });
      scenarios.forEach((item, scenarioIndex) => {
        const top = 374 + scenarioIndex * 76;
        addText(slide, Number(item.fit || 0).toFixed(1), { left: x + 20, top, width: 44, height: 26 }, { fontSize: 18, color: scenarioIndex === 0 ? C.accent : C.mint, bold: true });
        addFittedText(slide, item.name, { left: x + 70, top, width: 252, height: 24 }, { fontSize: 15, minFontSize: 13, color: index === 0 ? C.white : C.ink, bold: true, maxLines: 1 });
        addFittedText(slide, item.why, { left: x + 70, top: top + 27, width: 252, height: 38 }, { fontSize: 12, minFontSize: 11, color: index === 0 ? "#BED0C8" : C.muted, maxLines: 3, lineSpacing: 1.02 });
      });
      addText(slide, "适合度 /5", { left: x + 20, top: 604, width: 90, height: 16 }, { fontSize: 10, color: index === 0 ? "#BED0C8" : C.muted });
    });
    addNotes(slide, ["场景价值分衡量产品是否能把一类工作从发起推进到可验收结果。", "最佳场景来自真实界面和官方指南；缺少完整任务证据时会明确写限制。"], sourceSubset(a));
  }

  // Ease-of-use score.
  const usabilityScoreSlideIndex = deck.slides.count;
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Ease of use", 25);
    addTitle(slide, "易上手不等于能力少：要看完成一次任务需要用户做多少判断", "5 分代表更容易使用；分别比较入口、首次配置、步骤、反馈、恢复和结果验收");
    const groups = productAuditGroups.slice(0, 3);
    const labels = groups[0]?.usabilityScore?.dimensions?.map((item) => item.label) || ["入口清晰", "首次配置", "操作步骤", "运行反馈", "失败恢复", "结果验收"];
    addRect(slide, { left: 64, top: 216, width: 1144, height: 410 }, C.white, "rounded-xl", C.line);
    addRect(slide, { left: 64, top: 216, width: 210, height: 72 }, C.ink, "none");
    addText(slide, "使用环节", { left: 84, top: 240, width: 170, height: 26 }, { fontSize: 18, color: C.white, bold: true });
    const colW = 311;
    groups.forEach((group, index) => {
      const x = 274 + index * colW;
      const score = group.usabilityScore || {};
      addRect(slide, { left: x, top: 216, width: colW, height: 72 }, index === 0 ? C.accent : C.mint, "none");
      addFittedText(slide, group.competitorName, { left: x + 12, top: 228, width: colW - 100, height: 24 }, { fontSize: 16, minFontSize: 13, color: C.white, bold: true, maxLines: 1 });
      addText(slide, `${Number(score.total || 0).toFixed(1)}/5`, { left: x + colW - 86, top: 226, width: 70, height: 30 }, { fontSize: 22, color: C.white, bold: true, alignment: "right" });
      addText(slide, `${score.confidence?.level || "低"}置信度`, { left: x + 12, top: 258, width: 100, height: 18 }, { fontSize: 10, color: C.white });
    });
    labels.forEach((label, rowIndex) => {
      const top = 288 + rowIndex * 56;
      addText(slide, label, { left: 84, top: top + 17, width: 170, height: 24 }, { fontSize: 15, color: C.mint, bold: true });
      groups.forEach((group, index) => {
        const dimension = group.usabilityScore?.dimensions?.[rowIndex] || {};
        const x = 274 + index * colW;
        addText(slide, Number(dimension.score || 0).toFixed(1), { left: x + 16, top: top + 14, width: 34, height: 24 }, { fontSize: 17, color: Number(dimension.score || 0) <= 2 ? C.accent : C.mint, bold: true });
        addFittedText(slide, dimension.reason || "待验证", { left: x + 56, top: top + 8, width: colW - 72, height: 40 }, { fontSize: 12, minFontSize: 11, color: C.ink, maxLines: 3, lineSpacing: 1.02 });
      });
    });
    addNotes(slide, ["分数越高表示越容易上手，不代表产品能力更强。", "缺少执行、失败或结果页证据时，分数会标成暂定并降低置信度。"], sourceSubset(a));
  }

  // Same-job golden-task bakeoff. Unrun cells stay unrun; marketing claims are not passes.
  const bakeoffSlideIndex = deck.slides.count;
  {
    const slide = deck.slides.add();
    slide.background.fill = C.paper;
    addSlideChrome(slide, "Golden task bakeoff", 26);
    const bakeoff = a.bakeoff || {};
    const tasks = (bakeoff.tasks || []).slice(0, 6);
    const products = [...new Set((bakeoff.tasks || []).flatMap((task) => (task.runs || []).map((run) => run.product)))].filter(Boolean).slice(0, 3);
    const scorecard = bakeoff.scorecard || {};
    addTitle(slide, "同一批黄金任务，实际跑过没有", "不装软件：先核验网页版/教程/视频路径。没有实测的格子写未跑，公开路径不能填通过");
    const names = products.length ? products : firstCompetitors.map((item) => item.name).slice(0, 3);
    const rows = tasks.length ? tasks : [{ id: "T01", name: "待建立黄金任务", success: "事先写清交差标准", runs: [] }];
    const colW = Math.min(280, Math.floor(900 / Math.max(1, names.length)));
    const rowH = Math.min(64, Math.floor(412 / Math.max(1, rows.length)));
    addRect(slide, { left: 64, top: 214, width: 1144, height: 48 + rows.length * rowH }, C.white, "rounded-xl", C.line);
    addRect(slide, { left: 64, top: 214, width: 236, height: 48 }, C.ink, "none");
    addText(slide, "黄金任务", { left: 84, top: 227, width: 196, height: 24 }, { fontSize: 16, color: C.white, bold: true });
    names.forEach((name, index) => {
      addRect(slide, { left: 300 + index * colW, top: 214, width: colW, height: 48 }, index === 0 ? C.accent : C.mint, "none");
      addFittedText(slide, short(name, 16), { left: 308 + index * colW, top: 226, width: colW - 16, height: 24 }, { fontSize: 16, minFontSize: 13, color: C.white, bold: true, maxLines: 1, alignment: "center" });
    });
    rows.forEach((task, rowIndex) => {
      const top = 262 + rowIndex * rowH;
      addFittedText(slide, short(task.name || task.id, 16), { left: 84, top: top + 8, width: 196, height: rowH - 16 }, { fontSize: 14, minFontSize: 12, color: C.mint, bold: true, maxLines: 3 });
      names.forEach((name, index) => {
        const run = (task.runs || []).find((item) => item.product === name) || { status: "not_run" };
        const cell = formatRunCell(run);
        const color = run.status === "passed" ? C.mint : run.status === "failed" ? C.accent : run.status === "partial" ? C.accent : C.muted;
        addText(slide, cell.title, { left: 308 + index * colW, top: top + 6, width: colW - 16, height: 20 }, { fontSize: 15, color, bold: true });
        addFittedText(slide, short(cell.detail, 28), { left: 308 + index * colW, top: top + 26, width: colW - 16, height: Math.max(18, rowH - 34) }, { fontSize: 12, minFontSize: 11, color: C.ink, maxLines: 2, lineSpacing: 1.02 });
      });
    });
    addText(slide, `已跑 ${scorecard.ranTaskCount || 0} / ${scorecard.taskCount || rows.length} 项；未跑 ${scorecard.unrunTaskCount ?? Math.max(0, (scorecard.taskCount || 0) - (scorecard.ranTaskCount || 0))} 项。未跑不等于失败。`, { left: 64, top: 648, width: 1144, height: 22 }, { fontSize: 14, color: C.muted });
    addNotes(slide, [
      bakeoff.summary || "尚未建立黄金任务评测集。",
      "九维评分和界面审计不能代替同一任务对照实验。没有实测记录时，格子保持未跑。",
    ], sourceSubset(a));
  }

  // One coherent story shared with the web report: decision -> demand/scenarios ->
  // real application evidence -> interaction/data/backend -> comparison -> business.
  deck = reorderPresentation(deck, [
    0, 1, 2, 3, 5, 13,
    ...productEvidenceSlideIndexes,
    scenarioValueSlideIndex, usabilityScoreSlideIndex, bakeoffSlideIndex,
    14, 15, 16, 18, 17,
    11, 12, 19,
  ]);

  const temp = path.join(os.tmpdir(), `ai-ca-${crypto.randomUUID()}.pptx`);
  try {
    const file = await PresentationFile.exportPptx(deck);
    await file.save(temp);
    return await normalizePptxTypography(await fs.readFile(temp));
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
    await fs.rm(`${temp}.inspect.ndjson`, { force: true }).catch(() => {});
  }
}

const DOC = {
  navy: "11231F",
  accent: "FF6B35",
  mint: "2E8B77",
  pale: "F5F3EC",
  line: "D9DED8",
  muted: "5C6F68",
  white: "FFFFFF",
};

function text(value, options = {}) {
  return new TextRun({
    text: String(value || ""),
    font: "Microsoft YaHei",
    size: options.size || 22,
    bold: options.bold,
    italics: options.italics,
    color: options.color || DOC.navy,
  });
}

function para(value, options = {}) {
  const runs = Array.isArray(value) ? value : [text(value, options)];
  return new Paragraph({
    children: runs,
    heading: options.heading,
    alignment: options.alignment,
    spacing: { before: options.before ?? 0, after: options.after ?? 140, line: options.line || 320 },
    bullet: options.bullet ? { level: 0 } : undefined,
    pageBreakBefore: options.pageBreakBefore,
    keepNext: options.keepNext,
  });
}

function heading(value, level = 1) {
  return para(value, { heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, keepNext: true });
}

function bulletList(items) {
  const values = Array.isArray(items) && items.length ? items : ["待补充"];
  return values.map((item) => para(item, { bullet: true, after: 80 }));
}

function makeCell(value, width, options = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    shading: options.fill ? { type: ShadingType.CLEAR, fill: options.fill } : undefined,
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [para(value, {
      after: 0,
      alignment: options.center ? AlignmentType.CENTER : AlignmentType.LEFT,
      size: options.size || 19,
      bold: options.bold,
      color: options.color || DOC.navy,
    })],
  });
}

function table(rows, widths, options = {}) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    indent: { size: 120, type: WidthType.DXA },
    columnWidths: widths,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: DOC.line },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: DOC.line },
      left: { style: BorderStyle.SINGLE, size: 4, color: DOC.line },
      right: { style: BorderStyle.SINGLE, size: 4, color: DOC.line },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 3, color: DOC.line },
      insideVertical: { style: BorderStyle.SINGLE, size: 3, color: DOC.line },
    },
    rows: rows.map((row, rowIndex) => new TableRow({
      tableHeader: options.header && rowIndex === 0,
      cantSplit: true,
      children: row.map((value, colIndex) => makeCell(value, widths[colIndex], {
        fill: rowIndex === 0 && options.header ? DOC.navy : rowIndex % 2 ? "FFFFFF" : DOC.pale,
        color: rowIndex === 0 && options.header ? DOC.white : DOC.navy,
        bold: rowIndex === 0 && options.header,
        center: options.centerColumns?.includes(colIndex),
      })),
    })),
  });
}

function pageHeader(title) {
  return new Header({ children: [para([
    text("AI COMPETITOR INTELLIGENCE", { size: 17, bold: true, color: DOC.mint }),
    text(`    ${title}`, { size: 17, color: DOC.muted }),
  ], { after: 80 })] });
}

function pageFooter() {
  return new Footer({ children: [new Paragraph({
    alignment: AlignmentType.RIGHT,
    children: [text("CONFIDENTIAL  ·  ", { size: 16, color: DOC.muted }), new TextRun({ children: [PageNumber.CURRENT], font: "Microsoft YaHei", size: 16, color: DOC.muted })],
  })] });
}

function evidenceParagraph(item) {
  const children = [text(`${item.id}  ${item.title}`, { size: 19, bold: true })];
  if (item.url) {
    children.push(text("  ", { size: 19 }));
    children.push(new ExternalHyperlink({
      link: item.url,
      children: [new TextRun({ text: "打开来源", style: "Hyperlink", font: "Microsoft YaHei", size: 19 })],
    }));
  }
  return new Paragraph({ children, spacing: { after: 50 } });
}

export async function buildDocx(rawAnalysis, visualDataUrl = "") {
  const a = normalizeAnalysis(rawAnalysis);
  const children = [];

  // Editorial cover.
  children.push(para("AI PRODUCT COMPETITIVE INTELLIGENCE", { alignment: AlignmentType.CENTER, before: 1200, after: 380, size: 19, bold: true, color: DOC.mint }));
  children.push(para(a.meta.title, { alignment: AlignmentType.CENTER, after: 180, size: 54, bold: true }));
  children.push(para(a.meta.decisionQuestion, { alignment: AlignmentType.CENTER, after: 620, size: 28, color: DOC.muted }));
  children.push(para(`${a.meta.date}  |  面向：${a.meta.audience}`, { alignment: AlignmentType.CENTER, after: 120, size: 20, bold: true }));
  children.push(para(`分析目标：${a.meta.objective}`, { alignment: AlignmentType.CENTER, after: 500, size: 20, color: DOC.muted }));
  children.push(para("分析方法：从用户要完成的工作出发，逐步核对入口、操作、反馈、失败恢复、结果和权限", { alignment: AlignmentType.CENTER, size: 18, color: DOC.accent }));
  children.push(para(`调研：${a.research.mode === "web_search" ? `联网搜索（${a.research.searchCalls} 次）` : a.research.mode === "demo" ? "演示数据" : "离线材料"}`, { alignment: AlignmentType.CENTER, size: 17, color: DOC.muted }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  children.push(heading("执行摘要"));
  children.push(para(a.executiveSummary.headline, { size: 30, bold: true, after: 180 }));
  children.push(para(a.executiveSummary.verdict, { size: 23, color: DOC.mint, bold: true, after: 220 }));
  children.push(heading("核心发现", 2), ...bulletList(a.executiveSummary.insights));
  children.push(heading("建议动作", 2), ...bulletList(a.executiveSummary.actions));

  if (visualDataUrl.startsWith("data:image/png;base64,")) {
    const data = Buffer.from(visualDataUrl.split(",")[1], "base64");
    children.push(heading("竞争格局快照", 2));
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
      children: [new ImageRun({ data, transformation: { width: 620, height: 330 }, type: "png", altText: { title: "竞争评分图", description: "各竞品九维评分可视化", name: "competition-score-chart" } })],
    }));
  }

  children.push(heading("1. 这份报告分析什么", 1));
  children.push(para("本报告先确定用户真正要完成的工作，再用真实应用界面检查每个产品怎样帮助用户开始、执行、处理失败和拿到结果。评分只用于快速定位，最终判断必须能回到具体证据。"));
  children.push(table([
    ["分析对象", "角色", "定位", "商业模式"],
    ...a.competitors.map((item) => [item.name, item.role, item.positioning, item.businessModel]),
  ], [1600, 1300, 3800, 2660], { header: true, centerColumns: [1] }));
  children.push(para("表 1  分析对象与边界", { size: 17, color: DOC.muted, after: 220 }));
  children.push(heading("调研状态", 2));
  children.push(para(a.research.summary));
  children.push(table([
    ["模式 / 状态", "搜索次数", "调研范围", "仍待补证"],
    [`${a.research.mode} / ${a.research.status}`, String(a.research.searchCalls), a.research.scope.join("；") || "待记录", a.research.gaps.join("；") || "无"],
  ], [1800, 1000, 3280, 3280], { header: true, centerColumns: [1] }));

  children.push(heading("2. 用户需求与核心场景"));
  children.push(table([
    ["用户类型", "描述", "目标", "痛点", "证据"],
    ...a.userNeeds.personas.map((item) => [item.name, item.description, item.goals.join("；") || "待验证", item.pains.join("；") || "待验证", item.evidenceIds.join("、") || "无"]),
  ], [1400, 2200, 2100, 2200, 1460], { header: true }));
  children.push(heading("关键场景", 2));
  children.push(table([
    ["场景", "触发", "任务", "期望结果", "证据"],
    ...a.userNeeds.scenarios.map((item) => [item.name, item.trigger, item.task, item.outcome, item.evidenceIds.join("、") || "无"]),
  ], [1500, 1800, 2300, 2300, 1460], { header: true }));
  children.push(heading("需求优先级", 2));
  children.push(table([
    ["基础型", "期望型", "兴奋型", "无差异"],
    [a.userNeeds.kano.mustBe.join("\n") || "待验证", a.userNeeds.kano.performance.join("\n") || "待验证", a.userNeeds.kano.delighters.join("\n") || "待验证", a.userNeeds.kano.indifferent.join("\n") || "待验证"],
  ], [2340, 2340, 2340, 2340], { header: true }));
  children.push(heading("值得进一步解决的问题", 2), ...bulletList(a.userNeeds.hmw));

  children.push(heading("3. 行业与时机"));
  children.push(para(`阶段判断：${a.market.stage}`, { size: 25, bold: true, color: DOC.mint }));
  children.push(para(a.market.trend));
  children.push(table([
    ["规模信号", "里程碑事件", "下一转折"],
    [a.market.sizeSignal, a.market.milestone, a.market.nextInflection],
  ], [3000, 3000, 3360], { header: true }));
  children.push(heading("驱动因素", 2), ...bulletList(a.market.drivers));
  children.push(heading("主要风险", 2), ...bulletList(a.market.risks));

  children.push(heading("4. 九维竞争评分"));
  const scoreRows = [
    ["竞品", "加权总分", ...DIMENSIONS.map((item) => item.label)],
    ...a.competitors.map((competitor) => [
      competitor.name,
      competitor.score.toFixed(1),
      ...DIMENSIONS.map((item) => competitor.scores[item.key].toFixed(1)),
    ]),
  ];
  children.push(table(scoreRows, [1320, 720, 810, 810, 810, 810, 810, 810, 810, 810, 840], { header: true, centerColumns: [1,2,3,4,5,6,7,8,9,10] }));
  children.push(para("表 2  九维评分（0–10）。缺证据项目不得高于 5 分。", { size: 17, color: DOC.muted, after: 220 }));
  a.competitors.forEach((competitor) => {
    children.push(heading(`${competitor.name}｜评分依据`, 2));
    children.push(table([
      ["维度", "评分", "证据 ID", "评分理由 / 置信度"],
      ...DIMENSIONS.map((dimension) => {
        const rationale = competitor.scoreRationales[dimension.key];
        return [
          dimension.label,
          competitor.scores[dimension.key].toFixed(1),
          rationale.evidenceIds.join("、") || "无",
          `${rationale.rationale}｜${rationale.confidence}`,
        ];
      }),
    ], [1200, 700, 1400, 6060], { header: true, centerColumns: [1] }));
  });

  children.push(heading("5. 每个产品到底怎样解决问题"));
  a.competitors.forEach((competitor) => {
    children.push(heading(`${competitor.name}｜${competitor.positioning}`, 2));
    children.push(table([
      ["维度", "分析"],
      ["目标用户", competitor.targetUsers.join("、") || "待验证"],
      ["核心任务", competitor.coreJobs.join("、") || "待验证"],
      ["用户怎样完成任务", competitor.coreJourney.join(" → ") || "待验证"],
      ["定价", competitor.pricing || "待验证"],
      ["优势", competitor.strengths.join("；") || "待验证"],
      ["短板", competitor.weaknesses.join("；") || "待验证"],
    ], [1800, 7560], { header: true }));
  });

  children.push(heading("6. 界面证据与实现口径"));
  const px = a.productExperience || {};
  children.push(para("本章只采用应用内工作台、官方教程或可信实操界面。官网首页、价格页和宣传图不计入 UI 证据。没有截图的判断一律标为待验证。"));
  children.push(heading("逐品界面与设置侧重点", 2));
  (px.competitorAudits || []).forEach((group) => {
    children.push(heading(`${group.competitorName}｜${group.role || "竞品"}`, 2));
    children.push(para(`一句话看懂：${group.designFocus || "待验证"}`));
    children.push(table([
      ["维度", "判断"],
      ["用户怎样开始和完成任务", (group.designLogic || []).slice(0, 1).join("；") || "待验证"],
      ["运行中怎样反馈、失败后怎样继续", (group.interactionLogic || []).slice(0, 3).join("；") || "待验证"],
      ["界面优点", (group.strengths || []).join("；") || "待验证"],
      ["界面短板", (group.weaknesses || []).join("；") || "待验证"],
    ], [2200, 7160], { header: true }));
    if ((group.settings || []).length) {
      children.push(table([
        ["设置项", "作用", "默认", "用户影响", "商业意图"],
        ...group.settings.map((item) => [item.name, item.purpose, item.defaultValue, item.userImpact, item.businessIntent]),
      ], [1400, 2000, 1400, 2280, 2280], { header: true }));
    }
    if ((group.interfaceAudit || []).length) {
      children.push(table([
        ["阶段 / 界面", "证据类型", "入口 / 主操作", "反馈 / 摩擦", "标注"],
        ...group.interfaceAudit.map((item) => [
          `${item.usageStage}｜${item.screen}`,
          item.sourceType,
          `${item.entry}／${item.primaryAction}`,
          `${item.feedback}／${item.friction}`,
          item.annotation,
        ]),
      ], [1600, 1400, 2200, 2200, 1960], { header: true }));
    }
    const scenarioValue = group.scenarioValue || {};
    children.push(heading("最适合替用户完成什么工作", 3));
    children.push(para(`最能体现价值的场景：${scenarioValue.bestScene || "待验证"}`, { bold: true, color: DOC.mint }));
    children.push(para(scenarioValue.summary || "待验证"));
    if ((scenarioValue.scenarios || []).length) {
      children.push(table([
        ["工作场景", "适合度", "适合做什么", "为什么有价值", "证据与限制"],
        ...scenarioValue.scenarios.map((item) => [item.name, `${Number(item.fit || 0).toFixed(1)}/5`, item.work, item.why, `${item.evidenceScreen}；${item.limitation}`]),
      ], [1500, 900, 2100, 2400, 2460], { header: true, centerColumns: [1] }));
    }
    const usability = group.usabilityScore || {};
    children.push(heading("容易上手还是使用成本高", 3));
    children.push(para(`综合评分：${Number(usability.total || 0).toFixed(1)}/5；证据置信度：${usability.confidence?.level || "低"}。${usability.verdict || "待验证"}`, { bold: true }));
    if ((usability.dimensions || []).length) {
      children.push(table([
        ["使用环节", "评分", "为什么", "界面证据"],
        ...usability.dimensions.map((item) => [item.label, `${Number(item.score || 0).toFixed(1)}/5`, item.reason, item.evidenceScreen]),
      ], [1600, 900, 4660, 2200], { header: true, centerColumns: [1] }));
    }
  });
  const bakeoff = a.bakeoff || {};
  const bakeoffTasks = bakeoff.tasks || [];
  const bakeoffProducts = [...new Set(bakeoffTasks.flatMap((task) => (task.runs || []).map((run) => run.product)))].filter(Boolean);
  children.push(heading("同一批黄金任务，实际跑过没有", 2));
  children.push(para(bakeoff.method || "同一份工作实测：固定任务、同一材料、同一成功标准。未跑写未跑，禁止用功能清单或官网宣传填满分。", { bold: true }));
  children.push(para(bakeoff.summary || `已跑 ${bakeoff.scorecard?.ranTaskCount || 0} / 共 ${bakeoff.scorecard?.taskCount || bakeoffTasks.length} 项；未跑 ${bakeoff.scorecard?.unrunTaskCount || 0} 项。未实测的格子只标未跑，不按宣传材料打通过。`));
  if (bakeoffTasks.length && bakeoffProducts.length) {
    children.push(table([
      ["黄金任务", ...bakeoffProducts],
      ...bakeoffTasks.map((task) => [
        `${task.id} ${task.name}\n成功标准：${task.success || "待定义"}`,
        ...bakeoffProducts.map((name) => formatRunCellText((task.runs || []).find((item) => item.product === name))),
      ]),
    ], [2400, ...bakeoffProducts.map(() => Math.floor(6960 / Math.max(1, bakeoffProducts.length)))], { header: true }));
  } else {
    children.push(para("尚未形成黄金任务实测对照。没有实测记录时，不把宣传材料里的能力写成已跑过。"));
  }
  if ((bakeoff.protocol || []).length) {
    children.push(...bulletList(bakeoff.protocol));
  }
  children.push(heading("同一件工作，各产品让用户怎样完成", 2));
  const comparison = px.comparison || {};
  const products = [...new Set((comparison.cells || []).map((item) => item.product))];
  const dimensions = comparison.dimensions?.length ? comparison.dimensions : [...new Set((comparison.cells || []).map((item) => item.dimension))];
  const cellMap = new Map((comparison.cells || []).map((item) => [`${item.dimension}::${item.product}`, item]));
  if (products.length && dimensions.length) {
    children.push(table([
      ["用户要做的事", ...products],
      ...dimensions.map((dimension) => [dimension, ...products.map((name) => {
        const cell = cellMap.get(`${dimension}::${name}`) || {};
        return `${cell.focus || "待验证"}${cell.note ? `｜${cell.note}` : ""}`;
      })]),
    ], [1800, ...products.map(() => Math.floor(7560 / Math.max(1, products.length)))], { header: true }));
  } else {
    children.push(para("尚未形成横向对比。需要取得各产品真实界面后，再比较从哪里开始、怎样操作、卡住后怎么办和最后怎样拿到结果。"));
  }
  children.push(heading("一件任务由谁接手，系统怎样配合", 2));
  if ((px.swimlanes || []).length) {
    children.push(table([
      ["泳道 / 阶段", ...(px.swimlanes || []).map((item) => item.stage)],
      ["用户", ...(px.swimlanes || []).map((item) => item.user)],
      ["前端", ...(px.swimlanes || []).map((item) => item.frontend)],
      ["Agent", ...(px.swimlanes || []).map((item) => item.agent)],
      ["运营", ...(px.swimlanes || []).map((item) => item.operations)],
      ["数据", ...(px.swimlanes || []).map((item) => item.data)],
    ], [1400, ...Array.from({ length: (px.swimlanes || []).length }, () => Math.floor(7960 / Math.max(1, px.swimlanes.length)))], { header: true }));
  } else {
    children.push(para("尚未形成用户、前端、Agent、运营与数据泳道。"));
  }
  children.push(heading("需要记录哪些行为，才能做产品判断", 2));
  if ((px.trackingPlan || []).length) {
    children.push(table([
      ["事件", "触发", "指标", "产品决策", "属性"],
      ...px.trackingPlan.map((item) => [item.event, item.trigger, item.metric, item.decision, (item.properties || []).join("、") || "待定义"]),
    ], [1600, 1800, 1600, 2200, 2160], { header: true }));
  }
  children.push(para(`保存数据时必须做到：${(px.dataModel?.principles || []).join("；") || "不同企业的数据互不混用，任务过程可以追查，失败任务可以继续"}`));
  if ((px.dataModel?.entities || []).length) {
    children.push(table([
      ["需要保存的业务对象", "为什么要保存", "识别信息", "与其他对象的关系", "保留多久"],
      ...px.dataModel.entities.map((item) => [item.name, item.purpose, (item.keyFields || []).join("、") || "待定义", (item.relations || []).join("；") || "待定义", item.retention]),
    ], [1400, 2200, 2200, 2000, 1560], { header: true }));
  }
  const backend = px.backendDelivery || {};
  children.push(heading("为了让这些界面真正可用，后端最少要做什么", 2));
  children.push(para(backend.summary || "从界面状态反推最小可交付实现，待产品与研发共同验收。"));
  if ((backend.apis || []).length) {
    children.push(table([
      ["方法", "路径", "用途", "载荷"],
      ...backend.apis.map((item) => [item.method, item.path, item.purpose, item.payload]),
    ], [1000, 2200, 2800, 3360], { header: true }));
  }
  if ((backend.jobs || []).length) {
    children.push(table([
      ["异步任务", "触发", "写入"],
      ...backend.jobs.map((item) => [item.name, item.trigger, item.writes]),
    ], [2200, 3580, 3580], { header: true }));
  }
  children.push(heading("权限与验收", 2), ...bulletList([...(backend.permissions || []), ...(backend.acceptance || [])]));
  const fromUi = px.businessFromUi || {};
  children.push(heading("从真实使用过程看需求、收费和长期机会", 2));
  children.push(table([
    ["维度", "从界面回推的判断"],
    ["需求", (fromUi.demand || []).join("；") || (a.userNeeds?.painPoints || []).slice(0, 3).join("；") || "待验证"],
    ["核心场景", (a.userNeeds?.scenarios || []).slice(0, 3).map((item) => item.name).join("；") || "待验证"],
    ["怎样收费", (fromUi.monetizationSurfaces || []).join("；") || a.economics?.model || "待从席位或额度入口验证"],
    ["开发与运行成本", [...a.opportunities.filter((item) => Number(item.effort) >= 7).slice(0, 2).map((item) => `${item.title}（投入 ${item.effort}/10）`), ...(fromUi.costDrivers || []).slice(0, 2)].join("；") || "待估算"],
    ["运营闭环", (fromUi.operatingLoops || []).join("；") || a.economics?.retention || "待验证"],
    ["发展前景", fromUi.outlook || "待验证"],
  ], [1800, 7560], { header: true }));

  children.push(heading("7. AI 在真实任务中的表现"));
  children.push(table([
    ["竞品", "模型策略", "效果/时延", "可靠/隐私", "数据飞轮", "集成/成本"],
    ...a.competitors.map((item) => [
      item.name,
      item.aiProfile.modelStrategy,
      `${item.aiProfile.quality} / ${item.aiProfile.latency}`,
      `${item.aiProfile.reliability} / ${item.aiProfile.privacy}`,
      item.aiProfile.dataFlywheel,
      `${item.aiProfile.integration} / ${item.aiProfile.cost}`,
    ]),
  ], [1400, 1500, 1700, 1700, 1500, 1560], { header: true }));

  children.push(heading("8. 数据与商业效率"));
  children.push(para(`北极星指标：${a.northStar.metric}`, { size: 27, bold: true, color: DOC.mint }));
  children.push(para(a.northStar.rationale));
  children.push(heading("护栏指标", 2), ...bulletList(a.northStar.guardrails));
  children.push(heading("三大数据系统", 2));
  children.push(table([
    ["系统", "目标", "核心指标", "漏斗", "缺口"],
    ...[["用户", a.dataSystems.user], ["增长", a.dataSystems.growth], ["营收", a.dataSystems.revenue]].map(([label, system]) => [label, system.goal, system.metrics.join("；") || "待定义", system.funnel.join(" → ") || "待定义", system.gaps.join("；") || "无"]),
  ], [900, 1900, 2200, 2500, 1860], { header: true }));
  children.push(heading("埋点与使用计划", 2));
  children.push(table([
    ["事件", "目的", "时机 / 位置", "负责人", "如何使用"],
    ...a.dataSystems.instrumentation.map((item) => [item.event, item.purpose, `${item.when} / ${item.where}`, item.owner, item.usage]),
  ], [1700, 2100, 2200, 1200, 2160], { header: true }));
  children.push(table([
    ["三级火箭", "当前策略"],
    ["提高访问", a.economics.acquisition],
    ["提高 ARPU", a.economics.arpu],
    ["提高回访", a.economics.retention],
  ], [2200, 7160], { header: true }));
  children.push(heading("效率杠杆", 2), ...bulletList(a.economics.efficiencyLevers));
  children.push(heading("定价与单位经济", 2));
  children.push(table([
    ["定价策略", "单位经济假设"],
    [a.economics.pricing.join("；") || "待验证", a.economics.unitEconomics.join("；") || "待验证"],
  ], [4680, 4680], { header: true }));

  children.push(heading("9. 机会优先级"));
  children.push(table([
    ["机会", "理由", "影响", "信心", "投入", "窗口", "证据", "指标"],
    ...a.opportunities.map((item) => [item.title, item.rationale, item.impact.toFixed(1), item.confidence.toFixed(1), item.effort.toFixed(1), item.horizon, item.evidenceIds.join("、") || "无", item.metric]),
  ], [1300, 2100, 600, 600, 600, 700, 1260, 2200], { header: true, centerColumns: [2,3,4,5] }));
  children.push(heading("机会执行卡", 2));
  children.push(table([
    ["机会 / 负责人", "价值 / 风险", "最小实验", "成功标准", "下一步", "资源 / 依赖"],
    ...a.opportunities.map((item) => [
      `${item.title}\n${item.owner}`,
      `${item.value}\n风险：${item.risk}`,
      item.experiment,
      item.successCriteria,
      item.nextStep,
      `${item.resources.join("、") || "待定义"}\n依赖：${item.dependencies.join("、") || "待定义"}`,
    ]),
  ], [1500, 1900, 1700, 1500, 1400, 1360], { header: true }));

  children.push(heading("10. 行动路线图"));
  children.push(table([
    ["Now（0–8 周）", "Next（2–6 月）", "Later（6 月+）"],
    [a.roadmap.now.join("\n") || "待补充", a.roadmap.next.join("\n") || "待补充", a.roadmap.later.join("\n") || "待补充"],
  ], [3120, 3120, 3120], { header: true }));

  children.push(heading("11. 证据登记与限制"));
  if (a.evidence.length) {
    a.evidence.forEach((item) => {
      children.push(evidenceParagraph(item));
      children.push(para(`${item.type}｜${item.date || "日期待补"}｜置信度：${item.confidence}｜支持结论：${item.claim || "待补充"}`, { size: 18, color: DOC.muted, after: 130 }));
    });
  } else {
    children.push(para("尚未提供可追溯证据。当前结论仅可作为研究假设。"));
  }
  children.push(heading("自动审计", 2));
  children.push(para(`评分证据覆盖：${a.audit.scoreEvidenceCoverage}%｜机会证据覆盖：${a.audit.opportunityEvidenceCoverage}%｜评分自动降级：${a.audit.adjustedScores.length}｜机会自动降级：${a.audit.adjustedOpportunities.length}｜无效引用：${a.audit.invalidEvidenceReferences.length}`));
  children.push(heading("局限", 2), ...bulletList(a.limitations));

  const doc = new Document({
    creator: "AI Competitor Analyst",
    title: a.meta.title,
    description: a.meta.objective,
    styles: {
      default: { document: { run: { font: "Microsoft YaHei", size: 22, color: DOC.navy }, paragraph: { spacing: { after: 140, line: 320 } } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Microsoft YaHei", size: 32, bold: true, color: DOC.navy }, paragraph: { spacing: { before: 280, after: 140 }, keepNext: true, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Microsoft YaHei", size: 26, bold: true, color: DOC.mint }, paragraph: { spacing: { before: 200, after: 100 }, keepNext: true, outlineLevel: 1 } },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720 },
        },
      },
      headers: { default: pageHeader(a.meta.product) },
      footers: { default: pageFooter() },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}
