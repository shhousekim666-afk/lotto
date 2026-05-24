// 하이퍼파라미터 sweep. train(301~1100) / hold-out(1101~1224) 분리 평가.
// 결과: backtest/sweep-summary.json (UI fetch용)

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDraws } from "./data-loader.js";
import { ALGOS, buildContext, mulberry32, seedFor } from "./algo-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "sweep-summary.json");

const TRAIN_START = 301, TRAIN_END = 1100;
const HOLD_START = 1101, HOLD_END = 1224;
const OVERFIT_PCT = 10; // hold-out hit이 train 대비 ±10% 초과시 overfitting 의심

// 알고리즘별 paramGrid (data-analyst 권장)
const GRIDS = {
  freq:    [{ topK: 5 }, { topK: 10 }, { topK: 15 }, { topK: 20 }],
  monte:   [{ sims: 1000 }, { sims: 5000 }, { sims: 10000 }, { sims: 30000 }],
  hotcold: [{ window: 10 }, { window: 20 }, { window: 30 }, { window: 50 }, { window: 100 }],
  genetic: (() => {
    const out = [];
    for (const g of [50, 100, 200])
      for (const p of [50, 100, 200]) out.push({ gens: g, popSize: p });
    return out;
  })(),
};

function intersect(a, b) {
  const set = new Set(b);
  return a.filter((x) => set.has(x)).length;
}

function paramKey(p) {
  return Object.entries(p).map(([k, v]) => `${k}=${v}`).join("/");
}

function evalRange(algoId, algoFn, opts, draws, start, end) {
  const hits = [];
  for (let round = start; round <= end; round++) {
    const past = draws.slice(0, round - 1);
    if (past.length < 50) continue;
    const actual = draws[round - 1].nums;
    const ctx = buildContext(past);
    const rng = mulberry32(seedFor(algoId, round, 0));
    const predicted = algoFn(ctx, rng, opts);
    hits.push(intersect(predicted, actual));
  }
  const mean = hits.reduce((a, b) => a + b, 0) / hits.length;
  const variance = hits.reduce((a, b) => a + (b - mean) ** 2, 0) / hits.length;
  return { hits, mean: +mean.toFixed(4), std: +Math.sqrt(variance).toFixed(4), count: hits.length };
}

function main() {
  const draws = loadDraws();
  const tStart = Date.now();
  const results = {};

  for (const algoId of Object.keys(GRIDS)) {
    const algo = ALGOS.find((a) => a.id === algoId);
    if (!algo) continue;
    const grid = GRIDS[algoId];
    process.stderr.write(`\n[${algoId}] ${grid.length} combos\n`);
    const trials = [];
    for (let i = 0; i < grid.length; i++) {
      const opts = grid[i];
      const tt = Date.now();
      const train = evalRange(algoId, algo.fn, opts, draws, TRAIN_START, TRAIN_END);
      const hold = evalRange(algoId, algo.fn, opts, draws, HOLD_START, HOLD_END);
      const deltaPct = train.mean === 0 ? 0 : ((train.mean - hold.mean) / train.mean) * 100;
      const overfit = Math.abs(deltaPct) > OVERFIT_PCT;
      const dt = ((Date.now() - tt) / 1000).toFixed(1);
      trials.push({
        params: opts,
        paramKey: paramKey(opts),
        trainMean: train.mean,
        trainStd: train.std,
        holdoutMean: hold.mean,
        holdoutStd: hold.std,
        deltaPct: +deltaPct.toFixed(2),
        overfit,
      });
      process.stderr.write(
        `  ${paramKey(opts)}: train=${train.mean}, hold=${hold.mean}, Δ${deltaPct.toFixed(1)}% ${overfit ? "⚠" : "·"} (${dt}s)\n`,
      );
    }
    // 정렬: hold-out hit 우선
    trials.sort((a, b) => b.holdoutMean - a.holdoutMean);
    // 현재 기본값 찾기
    const defaultsMap = {
      freq: { topK: 12 },
      monte: { sims: 100000 },
      hotcold: { window: 50 },
      genetic: { gens: 80, popSize: 120 },
    };
    results[algoId] = {
      name: algo.name,
      trials,
      best: trials[0],
      defaults: defaultsMap[algoId],
    };
  }

  const elapsed = (Date.now() - tStart) / 1000;
  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      trainRange: [TRAIN_START, TRAIN_END],
      holdoutRange: [HOLD_START, HOLD_END],
      overfitThresholdPct: OVERFIT_PCT,
      elapsedSec: +elapsed.toFixed(2),
      note: "각 조합 회차당 1 run (시드 고정). 알고리즘별 최적은 hold-out 기준. 자동 채택 X, 참고용.",
    },
    algos: results,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  process.stderr.write(`\n완료 ${elapsed.toFixed(0)}s, 저장: ${OUT}\n`);
}

main();
