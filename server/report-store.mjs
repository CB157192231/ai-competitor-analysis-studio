import fs from "node:fs/promises";
import path from "node:path";

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function sanitizeReportTopic(value) {
  let topic = String(value || "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "")
    .replace(/-+/g, "-")
    .replace(/[. -]+$/g, "")
    .slice(0, 60);
  if (!topic) topic = "AI竞品分析";
  if (WINDOWS_RESERVED.test(topic)) topic = `调研-${topic}`;
  return topic;
}

export function localDateStamp(date = new Date()) {
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function reportTopic(analysis) {
  return sanitizeReportTopic(
    analysis?.meta?.product
      || analysis?.meta?.researchTopic
      || analysis?.meta?.title
      || "AI竞品分析",
  );
}

export function reportFolderName(analysis, date = new Date()) {
  return `${reportTopic(analysis)}${localDateStamp(date)}`;
}

const FILE_LABELS = {
  pptx: "AI竞品分析汇报",
  docx: "AI竞品分析报告",
  json: "竞品分析项目",
};

export async function saveReport({ analysis, extension, data, reportsRoot, date = new Date() }) {
  const normalizedExtension = String(extension || "").toLowerCase();
  if (!Object.hasOwn(FILE_LABELS, normalizedExtension)) {
    throw new Error(`不支持的报告格式：${normalizedExtension || "未知"}`);
  }
  const topic = reportTopic(analysis);
  const folderPath = path.join(reportsRoot, reportFolderName(analysis, date));
  const fileName = `${topic}_${FILE_LABELS[normalizedExtension]}.${normalizedExtension}`;
  const savedPath = path.join(folderPath, fileName);
  await fs.mkdir(folderPath, { recursive: true });
  await fs.writeFile(savedPath, data);
  return { folderPath, fileName, savedPath };
}

function projectId(relativePath) {
  return Buffer.from(relativePath, "utf8").toString("base64url");
}

function resolveProjectPath(reportsRoot, id) {
  let relativePath;
  try {
    relativePath = Buffer.from(String(id || ""), "base64url").toString("utf8");
  } catch {
    throw new Error("项目标识无效");
  }
  const root = path.resolve(reportsRoot);
  const resolved = path.resolve(root, relativePath);
  if (!relativePath || (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root)) throw new Error("项目路径超出报告目录");
  if (!resolved.toLowerCase().endsWith(".json")) throw new Error("项目文件必须是 JSON");
  return resolved;
}

export async function listReportProjects(reportsRoot) {
  const root = path.resolve(reportsRoot);
  const projects = [];
  const folders = await fs.readdir(root, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const folder of folders.filter((item) => item.isDirectory())) {
    const folderPath = path.join(root, folder.name);
    const files = await fs.readdir(folderPath, { withFileTypes: true }).catch(() => []);
    for (const file of files.filter((item) => item.isFile() && item.name.endsWith("_竞品分析项目.json"))) {
      const absolutePath = path.join(folderPath, file.name);
      try {
        const [raw, stat] = await Promise.all([fs.readFile(absolutePath, "utf8"), fs.stat(absolutePath)]);
        const analysis = JSON.parse(raw);
        const relativePath = path.relative(root, absolutePath);
        projects.push({
          id: projectId(relativePath),
          title: String(analysis?.meta?.title || "AI 产品竞品分析"),
          product: String(analysis?.meta?.product || file.name.replace(/_竞品分析项目\.json$/u, "")),
          date: String(analysis?.meta?.date || ""),
          researchStatus: String(analysis?.research?.status || "not_started"),
          competitors: Array.isArray(analysis?.competitors) ? analysis.competitors.length : 0,
          evidence: Array.isArray(analysis?.evidence) ? analysis.evidence.length : 0,
          modifiedAt: stat.mtime.toISOString(),
          folderName: folder.name,
          fileName: file.name,
        });
      } catch {
        // Ignore damaged or non-project JSON files; loading remains deterministic.
      }
    }
  }
  return projects.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}

export async function readReportProject(reportsRoot, id) {
  const projectPath = resolveProjectPath(reportsRoot, id);
  const raw = await fs.readFile(projectPath, "utf8");
  return { analysis: JSON.parse(raw), projectPath };
}
