#!/usr/bin/env node
/**
 * Run sync-jobs only when job data is missing or older than 24 hours.
 * Used as prebuild on Vercel and locally.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const STALE_MS = 24 * 60 * 60 * 1000;

const META_PATHS = [
  path.join(ROOT, "public/data/jobs/meta.json"),
  path.join(ROOT, "src/data/jobs-meta.json"),
];

async function readGeneratedAt() {
  for (const metaPath of META_PATHS) {
    try {
      const raw = await fs.readFile(metaPath, "utf8");
      const meta = JSON.parse(raw);
      if (meta.generatedAt) return meta.generatedAt;
    } catch {
      // try next path
    }
  }
  return null;
}

function runSync() {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["scripts/sync-jobs.mjs"], {
      cwd: ROOT,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`sync-jobs exited with code ${code}`));
    });
  });
}

async function main() {
  const generatedAt = await readGeneratedAt();
  if (generatedAt) {
    const ageMs = Date.now() - new Date(generatedAt).getTime();
    if (ageMs < STALE_MS) {
      const hours = Math.floor(ageMs / (60 * 60 * 1000));
      console.log(
        `Role Hunter: job data is ${hours}h old (< 24h) — skipping sync before build.`,
      );
      return;
    }
    const hours = Math.floor(ageMs / (60 * 60 * 1000));
    console.log(`Role Hunter: job data is ${hours}h old — running sync before build…`);
  } else {
    console.log("Role Hunter: no job metadata found — running sync before build…");
  }

  await runSync();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
