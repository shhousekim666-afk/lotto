// walk-forward 백테스트. evaluator로 BSS + null + Bonferroni 산출.
//
// 사용:
//   node backtest/runner.js [--start N] [--end N] [--step N] [--rand N] [--monte-sims N]
//                           [--out-summary path] [--out-detail path] [--resume] [--keep-ckpt]
// 기본값: --start (전체-99) --end (전체) --step 1 --rand 5 --monte-sims 100000

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDraws } from "./data-loader.js";
import { ALGOS, buildContext, mulberry32, seedFor } from "./algo-adapter.js";
import { applyBonferroni, summarize } from "./evaluator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CKPT_DIR = resolve(__dirname, "checkpoints");

function parseArgs(argv) {
  const a = {
    step: 1,
    rand: 5,
    monteSims: 100000,
    outSummary: resolve(__dirname, "backtest-summary.json"),
    outDetail: resolve(__dirname, "backtest-detail.json"),
    resume: false,
    keepCkpt: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--start") (a.start = +v), i++;
    else if (k === "--end") (a.end = +v), i++;
    else if (k === "--step") (a.step = +v), i++;
    else if (k === "--rand") (a.rand = +v), i++;
    else if (k === "--monte-sims") (a.monteSims = +v), i++;
    else if (k === "--out-summary") (a.outSummary = v), i++;
    else if (k === "--out-detail") (a.outDetail = v), i++;
    else if (k === "--resume") a.resume = true;
    else if (k === "--keep-ckpt") a.keepCkpt = true;
  }
  return a;
}

function intersect(a, b) {
  const set = new Set(b);
  return a.filter((x) => set.has(x)).length;
}

function loadCheckpoint(algoId) {
  const file = resolve(CKPT_DIR, `ckpt-${algoId}.ndjson`);
  if (!existsSync(file)) return { file, completed: new Map() };
  const lines = readFileSync(file, "utf-8").split("\n").filter(Boolean);
  const completed = new Map();
  for (const ln of lines) {
    const rec = JSON.parse(ln);
    if (!completed.has(rec.round)) completed.set(rec.round, []);
    completed.get(rec.round).push(rec);
  }
  return { file, completed };
}

function main() {
  const args = parseArgs(process.argv);
  const draws = loadDraws();
  const start = args.start ?? draws.length - 99;
  const end = args.end ?? draws.length;
  const evalRounds = [];
  for (let r = start; r <= end; r += args.step) evalRounds.push(r);

  if (!existsSync(CKPT_DIR)) mkdirSync(CKPT_DIR, { recursive: true });

  // 알고리즘별 데이터 수집
  const acc = {};
  const ckptFiles = {};
  const skipMap = {};
  for (const a of ALGOS) {
    const { file, completed } = args.resume
      ? loadCheckpoint(a.id)
      : { file: resolve(CKPT_DIR, `ckpt-${a.id}.ndjson`), completed: new Map() };
    ckptFiles[a.id] = file;
    skipMap[a.id] = completed;
    acc[a.id] = { hits: [], details: [] };
    if (!args.resume && existsSync(file)) rmSync(file);

    // resume: 기존 체크포인트 데이터 acc에 복원
    if (args.resume) {
      for (const [round, recs] of completed) {
        let hitSum = 0;
        for (const rec of recs) {
          acc[a.id].details.push(rec);
          hitSum += rec.hitCount;
        }
        acc[a.id].hits.push(hitSum / recs.length);
      }
    }
  }

  const tStart = Date.now();
  const progressEvery = Math.max(1, Math.floor(evalRounds.length / 20));

  for (let i = 0; i < evalRounds.length; i++) {
    const round = evalRounds[i];
    const pastDraws = draws.slice(0, round - 1);
    if (pastDraws.length < 50) continue;
    const actual = draws[round - 1].nums;
    const ctx = buildContext(pastDraws);

    for (const algo of ALGOS) {
      if (args.resume && skipMap[algo.id].has(round)) continue;

      const runs = algo.det ? 1 : args.rand;
      const roundRecs = [];
      let hitSum = 0;

      for (let runIdx = 0; runIdx < runs; runIdx++) {
        const rng = algo.det ? null : mulberry32(seedFor(algo.id, round, runIdx));
        const opts = algo.id === "monte" ? { sims: args.monteSims } : undefined;
        const predicted = algo.fn(ctx, rng, opts);
        const hits = intersect(predicted, actual);
        const rec = { algoId: algo.id, round, runIdx, predicted, actual, hitCount: hits };
        roundRecs.push(rec);
        acc[algo.id].details.push(rec);
        hitSum += hits;
        appendFileSync(ckptFiles[algo.id], JSON.stringify(rec) + "\n");
      }
      acc[algo.id].hits.push(hitSum / runs);
    }

    if ((i + 1) % progressEvery === 0 || i === evalRounds.length - 1) {
      const elapsed = (Date.now() - tStart) / 1000;
      const pct = (((i + 1) / evalRounds.length) * 100).toFixed(1);
      const eta = (elapsed / (i + 1)) * (evalRounds.length - i - 1);
      process.stderr.write(
        `[${i + 1}/${evalRounds.length}, ${pct}%] round ${round}, elapsed ${elapsed.toFixed(0)}s, eta ${eta.toFixed(0)}s\n`,
      );
    }
  }

  // 평가
  process.stderr.write("\n평가 계산 중...\n");
  const nullCache = {}; // 알고리즘 간 null 분포 재사용
  const summaries = [];
  for (const algo of ALGOS) {
    const t0 = Date.now();
    const s = summarize({
      algoId: algo.id,
      name: algo.name,
      det: algo.det,
      hits: acc[algo.id].hits,
      details: acc[algo.id].details,
      randRuns: algo.det ? 1 : args.rand,
      nullCache,
    });
    summaries.push(s);
    process.stderr.write(`  ${algo.id}: bss=${s.bss}, p=${s.pValue} (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
  }
  applyBonferroni(summaries);

  const totalElapsed = (Date.now() - tStart) / 1000;

  // summary 출력
  const algosObj = {};
  for (const s of summaries) algosObj[s.algoId] = s;
  const summary = {
    meta: {
      generatedAt: new Date().toISOString(),
      totalDraws: draws.length,
      evalStart: start,
      evalEnd: end,
      step: args.step,
      randRuns: args.rand,
      monteSims: args.monteSims,
      elapsedSec: +totalElapsed.toFixed(2),
      detailFile: args.outDetail.split("/").pop(),
    },
    algos: algosObj,
  };
  writeFileSync(args.outSummary, JSON.stringify(summary, null, 2));

  // detail 출력
  const detailRounds = {};
  for (const a of ALGOS) {
    detailRounds[a.id] = acc[a.id].details.map((d) => ({
      round: d.round,
      runIdx: d.runIdx,
      predicted: d.predicted,
      actual: d.actual,
      hitCount: d.hitCount,
    }));
  }
  const detail = {
    meta: {
      generatedAt: new Date().toISOString(),
      summaryFile: args.outSummary.split("/").pop(),
    },
    rounds: detailRounds,
  };
  writeFileSync(args.outDetail, JSON.stringify(detail));

  // 체크포인트 정리
  if (!args.keepCkpt) {
    for (const f of Object.values(ckptFiles)) if (existsSync(f)) rmSync(f);
    if (existsSync(CKPT_DIR)) {
      try {
        rmSync(CKPT_DIR, { recursive: true, force: true });
      } catch {}
    }
  }

  process.stderr.write(`\n완료. summary: ${args.outSummary}\n        detail: ${args.outDetail}\n`);
}

main();
