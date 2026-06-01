#!/usr/bin/env node
/**
 * Build-time job sync for Role Hunter.
 * Fetches design roles from public ATS APIs (Greenhouse, Ashby, Lever)
 * aligned with https://ai-design-jobs.vercel.app/ — verifies URLs, writes JSON.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyCompanyAreas,
  dedupeJobs,
  fetchJobsForSource,
  sortJobs,
} from "../src/lib/jobs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SOURCES_PATH = path.join(__dirname, "job-sources.json");
const OUT_JOBS = path.join(ROOT, "src/data/jobs.json");
const OUT_META = path.join(ROOT, "src/data/jobs-meta.json");
const OUT_REPORT = path.join(__dirname, "sync-jobs-report.json");
const OUT_PUBLIC_DIR = path.join(ROOT, "public/data/jobs");
const PAGE_SIZE = 50;

const VERIFY_TIMEOUT_MS = 12_000;

async function loadSources() {
  const raw = await fs.readFile(SOURCES_PATH, "utf8");
  return JSON.parse(raw);
}

const TRUSTED_URL_HOSTS = [
  "greenhouse.io",
  "job-boards.greenhouse.io",
  "boards.greenhouse.io",
  "ashbyhq.com",
  "jobs.ashbyhq.com",
  "lever.co",
  "jobs.lever.co",
];

function isTrustedJobUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return TRUSTED_URL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

async function verifyUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, reason: "invalid-url" };
  }
  if (isTrustedJobUrl(url)) {
    return { ok: true, reason: "trusted-host" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    let res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "RoleHunterSync/1.0" },
    });
    if (res.status === 405 || res.status === 403) {
      res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "RoleHunterSync/1.0" },
      });
    }
    if (res.status === 404 || res.status === 410) {
      return { ok: false, reason: `http-${res.status}` };
    }
    if (res.status >= 400) {
      return { ok: false, reason: `http-${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAtsJobs(sources) {
  const jobs = [];
  const errors = [];
  for (const src of sources) {
    try {
      const batch = await fetchJobsForSource(src);
      jobs.push(...batch);
    } catch (err) {
      errors.push({ company: src.company, ats: src.ats, error: String(err.message) });
    }
  }
  return { jobs, errors };
}

async function filterVerified(jobs) {
  const verified = [];
  const dropped = [];
  const concurrency = 8;
  let index = 0;

  async function worker() {
    while (index < jobs.length) {
      const i = index++;
      const job = jobs[i];
      const result = await verifyUrl(job.url);
      if (result.ok) {
        verified.push(job);
      } else {
        dropped.push({
          company: job.company,
          role: job.role,
          url: job.url,
          source: job.source,
          reason: result.reason,
        });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { verified, dropped };
}

async function main() {
  console.log("Role Hunter: syncing jobs…");
  const sources = await loadSources();
  const { jobs: atsJobs, errors: atsErrors } = await fetchAtsJobs(sources);
  console.log(`ATS: ${atsJobs.length} design roles from ${sources.length} companies`);

  const merged = dedupeJobs(atsJobs);
  const withCompanyAreas = applyCompanyAreas(merged, sources);
  console.log(`Merged: ${withCompanyAreas.length} unique roles — verifying URLs…`);

  const { verified, dropped } = await filterVerified(withCompanyAreas);
  const sorted = sortJobs(verified);

  await fs.mkdir(path.dirname(OUT_JOBS), { recursive: true });
  await fs.writeFile(OUT_JOBS, JSON.stringify(sorted, null, 2) + "\n");

  await fs.mkdir(OUT_PUBLIC_DIR, { recursive: true });
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  for (let i = 0; i < pageCount; i++) {
    const page = sorted.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE);
    await fs.writeFile(
      path.join(OUT_PUBLIC_DIR, `page-${i + 1}.json`),
      JSON.stringify(page, null, 2) + "\n",
    );
  }
  const existingPages = await fs.readdir(OUT_PUBLIC_DIR);
  for (const name of existingPages) {
    const m = name.match(/^page-(\d+)\.json$/);
    if (m && Number(m[1]) > pageCount) {
      await fs.unlink(path.join(OUT_PUBLIC_DIR, name));
    }
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    counts: {
      ats: atsJobs.length,
      merged: merged.length,
      verified: sorted.length,
      dropped: dropped.length,
    },
    sources: sources.length,
  };
  await fs.writeFile(OUT_META, JSON.stringify(meta, null, 2) + "\n");
  await fs.writeFile(
    path.join(OUT_PUBLIC_DIR, "meta.json"),
    JSON.stringify({
      generatedAt: meta.generatedAt,
      totalCount: sorted.length,
      pageSize: PAGE_SIZE,
      pageCount,
    }, null, 2) + "\n",
  );

  const report = {
    generatedAt: meta.generatedAt,
    atsErrors,
    dropped,
    sampleTitles: sorted.slice(0, 8).map((j) => `${j.company} — ${j.role}`),
  };
  await fs.writeFile(OUT_REPORT, JSON.stringify(report, null, 2) + "\n");

  console.log(`Wrote ${sorted.length} verified jobs → ${OUT_JOBS}`);
  if (dropped.length) console.log(`Dropped ${dropped.length} (see sync-jobs-report.json)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
