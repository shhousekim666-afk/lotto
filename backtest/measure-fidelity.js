// 백테스트 detail.json을 후처리하여 알고리즘 자기 충실성 측정.
// 출력: fidelity-summary.json (UI가 백테스트 탭에서 fetch)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDraws } from "./data-loader.js";
import { ALGOS, buildContext } from "./algo-adapter.js";
import { fidelity, FIDELITY_BASELINE } from "./fidelity.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DETAIL = resolve(__dirname, "backtest-detail.json");
const OUT = resolve(__dirname, "fidelity-summary.json");

function main() {
  const detail = JSON.parse(readFileSync(DETAIL, "utf-8"));
  const draws = loadDraws();
  const algoIds = ALGOS.map((a) => a.id);

  // 회차별 ctx 캐싱 (모든 알고리즘이 공유)
  const ctxCache = new Map();
  function getCtx(round) {
    if (ctxCache.has(round)) return ctxCache.get(round);
    const past = draws.slice(0, round - 1);
    const c = buildContext(past);
    ctxCache.set(round, c);
    return c;
  }

  const result = { meta: { generatedAt: new Date().toISOString() }, algos: {} };

  for (const a of ALGOS) {
    const records = detail.rounds[a.id];
    if (!records || records.length === 0) {
      result.algos[a.id] = { name: a.name, evalCount: 0 };
      continue;
    }
    const t0 = Date.now();
    const values = [];
    let lastRound = -1;
    let ctx = null;
    for (const rec of records) {
      if (rec.round !== lastRound) {
        ctx = getCtx(rec.round);
        lastRound = rec.round;
      }
      const v = fidelity(a.id, rec.predicted, ctx);
      if (Number.isFinite(v)) values.push(v);
    }
    values.sort((x, y) => x - y);
    const n = values.length;
    const mean = values.reduce((s, x) => s + x, 0) / n;
    const variance = values.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);
    const median = values[Math.floor(n / 2)];
    const p5 = values[Math.floor(n * 0.05)];
    const p95 = values[Math.floor(n * 0.95)];
    result.algos[a.id] = {
      name: a.name,
      evalCount: n,
      mean: +mean.toFixed(4),
      std: +std.toFixed(4),
      median: +median.toFixed(4),
      p5: +p5.toFixed(4),
      p95: +p95.toFixed(4),
      baseline: FIDELITY_BASELINE[a.id],
    };
    const dt = (Date.now() - t0) / 1000;
    process.stderr.write(
      `  ${a.id}: mean=${mean.toFixed(3)}, median=${median.toFixed(3)} (${dt.toFixed(1)}s)\n`,
    );
  }

  writeFileSync(OUT, JSON.stringify(result, null, 2));
  process.stderr.write(`\n저장: ${OUT}\n`);
}

main();
