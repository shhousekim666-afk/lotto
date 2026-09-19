// 백테스트 메트릭 계산: Brier Skill Score(BSS), null 분포 p-value, 부트스트랩 CI.
// data-analyst가 확정한 의사코드에 따라 구현.

const NUMS = 45; // 1~45
const PICKS = 6;
const REF_P = PICKS / NUMS; // 6/45 무작위 기준 확률
import { mulberry32, seedFor } from './algo-adapter.js';
export const EVALUATION_VERSION = 2;

// 번호 집합 → 45-dim binary indicator (1-index 기준, [0] 미사용)
function toIndicator(numbers) {
  const v = new Float64Array(NUMS);
  for (const n of numbers) v[n - 1] = 1;
  return v;
}

// 두 벡터의 (1/45) Σ (a-b)² 평균 제곱 오차
function brierMSE(a, b) {
  let s = 0;
  for (let i = 0; i < NUMS; i++) s += (a[i] - b[i]) ** 2;
  return s / NUMS;
}

// 회차별 예측 indicator(rand 평균 또는 결정론 indicator) + 실제 indicator → 회차별 BS 배열
export function computeRoundBS(predVecs, actualVecs) {
  const n = predVecs.length;
  const bs = new Float64Array(n);
  const bsRef = new Float64Array(n);
  const ref = new Float64Array(NUMS).fill(REF_P);
  for (let i = 0; i < n; i++) {
    bs[i] = brierMSE(predVecs[i], actualVecs[i]);
    bsRef[i] = brierMSE(ref, actualVecs[i]);
  }
  return { bs, bsRef };
}

// BSS + 부트스트랩 CI
export function computeBSS({ bs, bsRef, nBoot = 10000, rng = Math.random }) {
  const n = bs.length;
  const meanBS = bs.reduce((a, b) => a + b, 0) / n;
  const meanBSRef = bsRef.reduce((a, b) => a + b, 0) / n;
  const bss = 1 - meanBS / meanBSRef;

  const bssBoot = new Float64Array(nBoot);
  for (let b = 0; b < nBoot; b++) {
    let sBS = 0,
      sRef = 0;
    for (let i = 0; i < n; i++) {
      const idx = (rng() * n) | 0;
      sBS += bs[idx];
      sRef += bsRef[idx];
    }
    bssBoot[b] = 1 - sBS / sRef;
  }
  const sorted = [...bssBoot].sort((a, b) => a - b);
  const ciLower = sorted[Math.floor(nBoot * 0.025)];
  const ciUpper = sorted[Math.floor(nBoot * 0.975)];
  return { bss, meanBS, meanBSRef, ciLower, ciUpper };
}

// 회차별 짝지은 손실 차이를 중심화한 부트스트랩 근사 검정.
// 반복 추천의 평균 확률을 그대로 평가하며 반복 횟수를 독립 표본으로 세지 않는다.
export function computeNullPValue({ bs, bsRef, nSim = 10000, rng = Math.random }) {
  if (!bs?.length || bs.length !== bsRef?.length || !Number.isInteger(nSim) || nSim < 1) throw new Error('검정 입력 오류');
  const differences = Array.from(bs, (loss, i) => bsRef[i] - loss);
  if (differences.some(x => !Number.isFinite(x))) throw new Error('손실은 유한수여야 합니다.');
  const observed = differences.reduce((a, b) => a + b, 0) / differences.length;
  // 균등 확률보다 손실이 작다는 단측 검정. 개선이 없으면 보수적으로 p=1.
  if (observed <= 1e-14) return { pValue: 1, simulations: 0 };
  const centered = differences.map(x => x - observed);
  let ge = 0;
  for (let s = 0; s < nSim; s++) {
    let total = 0;
    for (let i = 0; i < centered.length; i++) total += centered[Math.floor(rng() * centered.length)];
    if (total / centered.length >= observed - 1e-14) ge++;
  }
  return { pValue: (ge + 1) / (nSim + 1), simulations: nSim };
}

// 알고리즘별 종합 요약: details에서 predicted/actual을 추출하여 모든 메트릭 산출
export function summarize({ algoId, name, det, hits, details, randRuns, opts = {} }) {
  const evalRounds = hits.length;
  const hitMean = hits.reduce((a, b) => a + b, 0) / evalRounds;
  const variance = details.reduce((a, b) => a + (b.hitCount - hitMean) ** 2, 0) / details.length;
  const hitStd = Math.sqrt(variance);
  const hitDist = new Array(7).fill(0);

  // 회차별 그룹핑 (rand는 runIdx 0..randRuns-1)
  const byRound = new Map();
  for (const d of details) {
    if (!byRound.has(d.round)) byRound.set(d.round, []);
    byRound.get(d.round).push(d);
  }

  // 회차별 pred_vec (rand는 100회 평균), actual_vec
  const rounds = [...byRound.keys()].sort((a, b) => a - b);
  const predVecs = [];
  const actualVecs = [];
  for (const r of rounds) {
    const recs = byRound.get(r);
    const sumVec = new Float64Array(NUMS);
    for (const rec of recs) {
      const iv = toIndicator(rec.predicted);
      for (let i = 0; i < NUMS; i++) sumVec[i] += iv[i];
    }
    for (let i = 0; i < NUMS; i++) sumVec[i] /= recs.length;
    predVecs.push(sumVec);
    actualVecs.push(toIndicator(recs[0].actual));
    // 적중 분포는 결정론은 1회, rand는 첫 runIdx만 분포에 반영 (대표 한 번)
    hitDist[recs[0].hitCount]++;
  }

  // 회차별 BS
  const { bs, bsRef } = computeRoundBS(predVecs, actualVecs);

  // BSS + 부트스트랩 CI
  const { bss, meanBS, meanBSRef, ciLower, ciUpper } = computeBSS({
    bs,
    bsRef,
    nBoot: opts.nBoot ?? 10000,
    rng: mulberry32(seedFor(algoId, rounds[0], 101)),
  });

  // 각 알고리즘의 실제 손실 차이로 검정하므로 null 분포를 공유하지 않는다.
  const { pValue, simulations: nSim } = computeNullPValue({
    bs, bsRef, nSim: opts.nSim ?? 10000,
    rng: mulberry32(seedFor(algoId, rounds[0], 102)),
  });

  return {
    algoId,
    name,
    det,
    evalRounds,
    hitMean: +hitMean.toFixed(4),
    hitStd: +hitStd.toFixed(4),
    hitDist,
    meanBS: +meanBS.toFixed(6),
    meanBSRef: +meanBSRef.toFixed(6),
    bss: +bss.toFixed(6),
    bssCI: [+ciLower.toFixed(6), +ciUpper.toFixed(6)],
    pValue: +pValue.toFixed(6),
    nullSimCount: nSim,
    randRuns,
  };
}

// Bonferroni 보정: 알고리즘 수 × pValue (상한 1.0)
export function applyBonferroni(summaries, alpha = 0.05) {
  const k = summaries.length;
  const alphaAdj = alpha / k;
  for (const s of summaries) {
    s.pValueBonferroni = Math.min(1, +(s.pValue * k).toFixed(6));
    s.isSignificant = s.bss > 0 && s.pValueBonferroni < alpha;
    s.bonferroniAlpha = +alphaAdj.toFixed(6);
  }
  // BSS 순위
  const sortedByBSS = [...summaries].sort((a, b) => b.bss - a.bss);
  sortedByBSS.forEach((s, i) => (s.rankByBSS = i + 1));
}
