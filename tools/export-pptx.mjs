import fs from "node:fs/promises";
import path from "node:path";
import { buildPptx } from "../server/office.mjs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("Usage: node tools/export-pptx.mjs <analysis.json> <output.pptx>");
}

const analysis = JSON.parse(await fs.readFile(path.resolve(inputPath), "utf8"));
const pptx = await buildPptx(analysis);
await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(path.resolve(outputPath), pptx);
console.log(JSON.stringify({ bytes: pptx.length, outputPath: path.resolve(outputPath) }, null, 2));
