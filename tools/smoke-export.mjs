import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { DEMO_ANALYSIS } from "../server/analysis.mjs";
import { buildDocx, buildPptx } from "../server/office.mjs";

const outputDir = path.resolve("tmp/qa/office");
await fs.mkdir(outputDir, { recursive: true });

const pptx = await buildPptx(DEMO_ANALYSIS);
const docx = await buildDocx(DEMO_ANALYSIS);
await fs.writeFile(path.join(outputDir, "demo-analysis.pptx"), pptx);
await fs.writeFile(path.join(outputDir, "demo-analysis.docx"), docx);

const pptZip = await JSZip.loadAsync(pptx);
const noteFiles = Object.keys(pptZip.files).filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name));
const chartFiles = Object.keys(pptZip.files).filter((name) => /^ppt\/(?:slides\/)?charts\/chart\d+\.xml$/.test(name));
const expectedSlides = 21 + DEMO_ANALYSIS.competitors.length;
if (noteFiles.length !== expectedSlides) throw new Error(`Expected ${expectedSlides} note slides, found ${noteFiles.length}`);
if (chartFiles.length < 1) throw new Error(`Expected at least 1 native chart, found ${chartFiles.length}`);
const firstNotes = await pptZip.file(noteFiles[0]).async("string");
if (!firstNotes.includes("[Sources]")) throw new Error("PPTX speaker notes are missing [Sources]");
const pptXmlNames = Object.keys(pptZip.files).filter((name) => name.startsWith("ppt/") && name.endsWith(".xml"));
const pptXml = (await Promise.all(pptXmlNames.map((name) => pptZip.file(name).async("string")))).join("\n");
const visibleSlideXmlNames = Object.keys(pptZip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
const visibleSlideXml = (await Promise.all(visibleSlideXmlNames.map((name) => pptZip.file(name).async("string")))).join("\n");
const slideXml = await Promise.all(Array.from({ length: expectedSlides }, (_value, index) => pptZip.file(`ppt/slides/slide${index + 1}.xml`).async("string")));
if (!slideXml[3].includes("窗口期来自企业化")) throw new Error("PPTX narrative did not move market timing before scenario evidence");
if (!slideXml[7].includes("先看真实使用界面")) throw new Error("PPTX narrative did not move interface evidence before product conclusions");
if (!slideXml[8].includes("Atlas AI")) throw new Error("PPTX is missing the first product-specific UI evidence slide");
if (!slideXml.at(-1).includes("立项结论")) throw new Error("PPTX decision summary is no longer the final slide");
if (!visibleSlideXml.includes("同一批黄金任务")) throw new Error("PPTX is missing golden-task bakeoff slide");
if (!visibleSlideXml.includes("未跑")) throw new Error("PPTX bakeoff slide is missing unrun labeling");
if (/(?:\.{3}|…)/u.test(visibleSlideXml)) throw new Error("PPTX visible copy still contains ellipsis truncation");
if (!pptXml.includes('typeface="Microsoft YaHei"')) throw new Error("PPTX is missing Microsoft YaHei typography");
if (/typeface="(?:Calibri|Calibri Light|\+mj-lt|\+mn-lt)"/.test(pptXml)) throw new Error("PPTX still contains a fallback Latin theme font");

const docZip = await JSZip.loadAsync(docx);
const documentXml = await docZip.file("word/document.xml").async("string");
const stylesXml = await docZip.file("word/styles.xml").async("string");
const footerXml = (await Promise.all(Object.keys(docZip.files)
  .filter((name) => /^word\/footer\d+\.xml$/.test(name))
  .map((name) => docZip.file(name).async("string")))).join("\n");
const docTypographyXml = `${documentXml}\n${stylesXml}\n${footerXml}`;
if (!docTypographyXml.includes('w:eastAsia="Microsoft YaHei"')) throw new Error("DOCX is missing Microsoft YaHei East Asian typography");
if (/<w:rFonts\b(?![^>]*Microsoft YaHei)[^>]*>/.test(docTypographyXml)) throw new Error("DOCX contains a run with a non-YaHei font");
if (!documentXml.includes("<w:cantSplit/>")) throw new Error("DOCX table rows may split across pages");
if (!documentXml.includes("执行摘要")) throw new Error("DOCX is missing executive summary");
if (!documentXml.includes("用户需求与核心场景")) throw new Error("DOCX is missing user-needs section");
if (!documentXml.includes("九维竞争评分")) throw new Error("DOCX is missing score section");
if (!documentXml.includes("三大数据系统")) throw new Error("DOCX is missing data-systems section");
if (!documentXml.includes("机会执行卡")) throw new Error("DOCX is missing executable opportunity cards");
if (!documentXml.includes("界面证据与实现口径")) throw new Error("DOCX is missing UI evidence and backend delivery chapter");
if (!documentXml.includes("同一批黄金任务")) throw new Error("DOCX is missing golden-task bakeoff section");
if (!documentXml.includes("从界面读出的商业逻辑")) throw new Error("DOCX is missing business-from-UI section");

console.log(JSON.stringify({
  pptxBytes: pptx.length,
  docxBytes: docx.length,
  slides: Object.keys(pptZip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length,
  noteSlides: noteFiles.length,
  charts: chartFiles.length,
  outputDir,
}, null, 2));
