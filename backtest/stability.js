// 매주 회차 추가 시 추천 번호의 변화 추적 (사용자 체감 안정성).
// 최근 N주 동안 각 시점의 알고리즘 출력을 기록하고 변화량 측정.

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDraws } from "./data-loader.js";
import { ALGOS, buildContext, mulberry32, seedFor } from "./algo-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "stability-summary.json");

const WEEKS = 10; // 최근 10주

function intersect(a, b) {
  const set = new Set(b);
  return a.filter((x) => set.has(x)).length;
}
function jaccard(a, b) {
  const inter = intersect(a, b);
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : inter / union;
}

function main() {
  const draws = loadDraws();
  const lastRound = draws[draws.length - 1].no;
  const startRound = lastRound - WEEKS + 1;
  if (startRound < 50) throw new Error("회차 부족");

  const weeks = [];
  const tStart = Date.now();
  for (let r = startRound; r <= lastRound; r++) {
    const past = draws.slice(0, r); // 1~r회까지 (r번째 추첨 결과 포함)
    const ctx = buildContext(past);
    const date = draws[r - 1].date;
    const predictions = {};
    for (const algo of ALGOS) {
      const rng = algo.det ? null : mulberry32(seedFor(algo.id, r, 0));
      const opts = algo.id === "monte" ? { sims: 100000 } : undefined;
      predictions[algo.id] = algo.fn(ctx, rng, opts);
    }
    weeks.push({ round: r, date, predictions });
  }
  const elapsed = (Date.now() - tStart) / 1000;

  // 알고리즘별 변화 메트릭
  const stats = {};
  for (const algo of ALGOS) {
    const seq = weeks.map((w) => w.predictions[algo.id]);
    let totalDelta = 0; // 인접 주간 변경 번호 수 합
    let maxDelta = 0;
    let totalJaccard = 0;
    let changedTransitions = 0;
    for (let i = 1; i < seq.length; i++) {
      const overlap = intersect(seq[i - 1], seq[i]);
      const delta = 6 - overlap;
      totalDelta += delta;
      if (delta > maxDelta) maxDelta = delta;
      totalJaccard += jaccard(seq[i - 1], seq[i]);
      if (delta > 0) changedTransitions++;
    }
    const transitions = seq.length - 1;
    stats[algo.id] = {
      name: algo.name,
      det: algo.det,
      transitions,
      avgChangePerWeek: +(totalDelta / transitions).toFixed(2),
      maxChange: maxDelta,
      changedWeeks: changedTransitions,
      avgJaccard: +(totalJaccard / transitions).toFixed(3),
      firstVsLastOverlap: intersect(seq[0], seq[seq.length - 1]),
      firstVsLastJaccard: +jaccard(seq[0], seq[seq.length - 1]).toFixed(3),
    };
  }

  const result = {
    meta: {
      generatedAt: new Date().toISOString(),
      weekRange: [startRound, lastRound],
      weeksTracked: WEEKS,
      monteSims: 100000,
      seedConvention: "round=current_max, runIdx=0",
      elapsedSec: +elapsed.toFixed(2),
    },
    weeks,
    stats,
  };

  writeFileSync(OUT, JSON.stringify(result, null, 2));
  process.stderr.write(`완료 ${elapsed.toFixed(1)}s, 저장: ${OUT}\n\n`);
  process.stderr.write("알고리즘     | 평균 변경 | 최대 | 변경 주차 | Jaccard 평균 | 첫↔끝 교집합\n");
  process.stderr.write("-".repeat(80) + "\n");
  for (const id of Object.keys(stats)) {
    const s = stats[id];
    process.stderr.write(
      `${id.padEnd(11)} | ${String(s.avgChangePerWeek).padStart(7)} | ${String(s.maxChange).padStart(3)} | ${String(s.changedWeeks).padStart(8)} | ${String(s.avgJaccard).padStart(11)} | ${String(s.firstVsLastOverlap).padStart(10)}\n`,
    );
  }
}

main();
