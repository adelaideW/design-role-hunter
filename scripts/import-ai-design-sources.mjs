#!/usr/bin/env node
/**
 * Derive ATS company boards from https://ai-design-jobs.vercel.app/
 * and write scripts/job-sources.json (aligned with ai-design-jobs ingestion).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_PATH = path.join(__dirname, "job-sources.json");
const REPORT_PATH = path.join(__dirname, "import-sources-report.json");
const REFERENCE_URL = "https://ai-design-jobs.vercel.app/";

/** Board slug → display company name */
const BOARD_COMPANY_OVERRIDES = {
  anysphere: "Cursor",
  claylabs: "Clay",
  "comfy-org": "ComfyUI",
  "runway-ml": "Runway",
  runway: "Runway",
  Linear: "Linear",
  linear: "Linear",
  mirohq: "Miro",
  scaleai: "Scale AI",
  togetherai: "Together AI",
  together: "Together AI",
  lumaai: "Luma AI",
  thebrowser: "Arc",
  character: "Character AI",
  gongio: "Gong",
  cohere: "Cohere",
  sigmacomputing: "Sigma Computing",
  robinhood: "Robinhood",
  pandektes: "Pandektes",
  "tessera-labs": "Tessera Labs",
  "noise-labs": "Noise Labs",
  FlutterFlow: "FlutterFlow",
  clickup: "ClickUp",
  openai: "OpenAI",
  notion: "Notion",
  perplexity: "Perplexity",
  replicate: "Replicate",
  elevenlabs: "ElevenLabs",
  wandb: "Weights & Biases",
};

/** Board slug → domain */
const BOARD_DOMAIN_OVERRIDES = {
  anysphere: "cursor.sh",
  claylabs: "clay.com",
  "comfy-org": "comfy.org",
  "runway-ml": "runwayml.com",
  runway: "runwayml.com",
  mirohq: "miro.com",
  scaleai: "scale.com",
  togetherai: "together.ai",
  together: "together.ai",
  lumaai: "lumalabs.ai",
  thebrowser: "arc.net",
  character: "character.ai",
  gongio: "gong.io",
  cohere: "cohere.com",
  sigmacomputing: "sigmacomputing.com",
  robinhood: "robinhood.com",
  openai: "openai.com",
  notion: "notion.so",
  perplexity: "perplexity.ai",
  replicate: "replicate.com",
  elevenlabs: "elevenlabs.io",
  wandb: "wandb.ai",
  Linear: "linear.app",
  linear: "linear.app",
};

const ATS_URL_PATTERNS = [
  { ats: "ashby", re: /jobs\.ashbyhq\.com\/([^/"'\s?#]+)/i },
  { ats: "greenhouse", re: /job-boards\.greenhouse\.io\/([^/"'\s?#]+)/i },
  { ats: "greenhouse", re: /boards\.greenhouse\.io\/([^/"'\s?#]+)/i },
  { ats: "lever", re: /jobs\.lever\.co\/([^/"'\s?#]+)/i },
];

function titleCaseSlug(slug) {
  return slug
    .split(/[-_]/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

function boardKey(ats, board) {
  return `${ats}:${board.toLowerCase()}`;
}

function parseBoardFromUrl(url) {
  for (const { ats, re } of ATS_URL_PATTERNS) {
    const m = url.match(re);
    if (m) return { ats, board: m[1] };
  }
  return null;
}

function faviconDomainBefore(html, index) {
  const before = html.slice(Math.max(0, index - 2500), index);
  const matches = [...before.matchAll(/favicons\?domain=([^&"']+)/g)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

function extractBoardsFromHtml(html) {
  const boards = new Map();
  const applyRe =
    /href="(https?:\/\/(?:jobs\.ashbyhq\.com|job-boards\.greenhouse\.io|boards\.greenhouse\.io|jobs\.lever\.co)\/[^"]+)"/gi;

  let match;
  while ((match = applyRe.exec(html)) !== null) {
    const rawUrl = match[1];
    const parsed = parseBoardFromUrl(rawUrl);
    if (!parsed) continue;
    const key = boardKey(parsed.ats, parsed.board);
    const domain = faviconDomainBefore(html, match.index);
    if (!boards.has(key)) {
      boards.set(key, { ats: parsed.ats, board: parsed.board, domain });
    } else if (domain && !boards.get(key).domain) {
      boards.get(key).domain = domain;
    }
  }

  return boards;
}

function resolveCompany(entry) {
  const slug = entry.board;
  const lower = slug.toLowerCase();
  if (BOARD_COMPANY_OVERRIDES[slug]) return BOARD_COMPANY_OVERRIDES[slug];
  if (BOARD_COMPANY_OVERRIDES[lower]) return BOARD_COMPANY_OVERRIDES[lower];
  return titleCaseSlug(slug);
}

function resolveDomain(entry) {
  const slug = entry.board;
  const lower = slug.toLowerCase();
  if (BOARD_DOMAIN_OVERRIDES[slug]) return BOARD_DOMAIN_OVERRIDES[slug];
  if (BOARD_DOMAIN_OVERRIDES[lower]) return BOARD_DOMAIN_OVERRIDES[lower];
  if (entry.domain) return entry.domain;
  const base = lower.replace(/[^a-z0-9]+/g, "");
  return base ? `${base}.com` : "example.com";
}

function buildSource(entry, previousByKey) {
  const key = boardKey(entry.ats, entry.board);
  const prev = previousByKey.get(key);
  const company = prev?.company || resolveCompany(entry);
  const domain = resolveDomain(entry);
  const area = prev?.area || "AI";
  return { company, domain, ats: entry.ats, board: entry.board, area };
}

async function loadPrevious() {
  try {
    const raw = await fs.readFile(SOURCES_PATH, "utf8");
    const list = JSON.parse(raw);
    const map = new Map();
    for (const s of list) map.set(boardKey(s.ats, s.board), s);
    return { list, map };
  } catch {
    return { list: [], map: new Map() };
  }
}

async function main() {
  console.log(`Fetching ${REFERENCE_URL}…`);
  const res = await fetch(REFERENCE_URL, {
    headers: { "User-Agent": "RoleHunterImport/1.0" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch reference site: HTTP ${res.status}`);
  }
  const html = await res.text();
  const boards = extractBoardsFromHtml(html);
  if (boards.size === 0) {
    throw new Error("No ATS boards found in reference HTML — layout may have changed.");
  }

  const { list: previousList, map: previousByKey } = await loadPrevious();
  const sources = [...boards.values()]
    .map((entry) => buildSource(entry, previousByKey))
    .sort((a, b) => a.company.localeCompare(b.company));

  const previousKeys = new Set(previousList.map((s) => boardKey(s.ats, s.board)));
  const newKeys = new Set(sources.map((s) => boardKey(s.ats, s.board)));
  const added = sources.filter((s) => !previousKeys.has(boardKey(s.ats, s.board)));
  const removed = previousList.filter((s) => !newKeys.has(boardKey(s.ats, s.board)));

  await fs.writeFile(SOURCES_PATH, JSON.stringify(sources, null, 2) + "\n");

  const report = {
    generatedAt: new Date().toISOString(),
    referenceUrl: REFERENCE_URL,
    boardCount: sources.length,
    added: added.map((s) => ({ company: s.company, ats: s.ats, board: s.board })),
    removed: removed.map((s) => ({ company: s.company, ats: s.ats, board: s.board })),
  };
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

  console.log(`Wrote ${sources.length} sources → ${SOURCES_PATH}`);
  console.log(`  Added: ${added.length}, Removed: ${removed.length}`);
  if (added.length) {
    console.log("  New boards:", added.slice(0, 8).map((s) => `${s.company} (${s.ats}:${s.board})`).join(", "));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
