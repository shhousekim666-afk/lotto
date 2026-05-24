// 알고리즘 자기 충실성 메트릭.
// 각 알고리즘이 자신의 이론적 근거를 얼마나 잘 반영하는지 정량화.
// data-analyst 정의에 따른 구현.

// freq: 예측 6번호 평균 빈도의 z-score (전체 45개 빈도 분포 기준)
export function freqFidelity(predicted, ctx) {
  const all = ctx.freq.slice(1); // [1..45]
  const mu = all.reduce((a, b) => a + b, 0) / 45;
  const sigma = Math.sqrt(all.reduce((a, b) => a + (b - mu) ** 2, 0) / 45);
  if (sigma === 0) return 0;
  const meanPred = predicted.reduce((a, n) => a + ctx.freq[n], 0) / 6;
  return (meanPred - mu) / sigma;
}

// cooccur / monte: 예측 6번호 pairwise 공출현 평균 / 무작위 6개 pair 기댓값 비율
export function cooccurFidelity(predicted, ctx) {
  // 예측 6번호 → 15개 pair 평균 공출현
  let sumPred = 0, cntPred = 0;
  for (let i = 0; i < 6; i++)
    for (let j = i + 1; j < 6; j++) {
      sumPred += ctx.co[predicted[i]][predicted[j]];
      cntPred++;
    }
  const meanPred = sumPred / cntPred;
  // 전체 45×44 pair 평균 (대각 제외, 양방향 → 절반)
  let sumAll = 0;
  for (let i = 1; i <= 45; i++)
    for (let j = i + 1; j <= 45; j++) sumAll += ctx.co[i][j];
  const meanAll = sumAll / ((45 * 44) / 2);
  if (meanAll === 0) return 1;
  return meanPred / meanAll;
}

// monte: cooccur와 동일 기준 (점수 함수가 공출현 합)
export const monteFidelity = cooccurFidelity;

// delta: 예측 정렬 후 5개 간격 vs ctx.deltaAvg RMSE → 1/(1+rmse)로 변환
export function deltaFidelity(predicted, ctx) {
  const s = [...predicted].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 0; i < 5; i++) gaps.push(s[i + 1] - s[i]);
  const rmse = Math.sqrt(
    gaps.reduce((a, g, i) => a + (g - ctx.deltaAvg[i]) ** 2, 0) / 5,
  );
  return 1 / (1 + rmse);
}

// genetic: fitness 함수 값을 무작위 100개 6세트 분포의 percentile rank
export function geneticFidelity(predicted, ctx) {
  const { freq, totalPicks, avgSum, stdSum, avgOdd, stdOdd } = ctx;
  const avgF6 = (totalPicks / 45) * 6;
  function fitness(ind) {
    const fs = ind.reduce((a, n) => a + freq[n], 0);
    const s = ind.reduce((a, b) => a + b, 0);
    const o = ind.filter((n) => n % 2 !== 0).length;
    const pSum = ((s - avgSum) / stdSum) ** 2 * avgF6 * 0.05;
    const pOdd = ((o - avgOdd) / stdOdd) ** 2 * avgF6 * 0.05;
    return fs - pSum - pOdd;
  }
  const fpred = fitness(predicted);
  // 무작위 100개 6세트 fitness 분포
  const samples = [];
  let seed = 12345;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let k = 0; k < 200; k++) {
    const s = new Set();
    while (s.size < 6) s.add(((rng() * 45) | 0) + 1);
    samples.push(fitness([...s]));
  }
  samples.sort((a, b) => a - b);
  let below = 0;
  for (const v of samples) if (v < fpred) below++;
  return below / samples.length; // 0~1 percentile
}

// hotcold: 예측 hot+cold 점수 합 / 무작위 6개 평균 점수 합
export function hotcoldFidelity(predicted, ctx, opts = {}) {
  const window = opts.window ?? 50;
  const recent = ctx.draws.slice(-Math.min(window, ctx.draws.length));
  const recN = recent.length;
  const rf = new Array(46).fill(0);
  for (const d of recent) for (const x of d.nums) rf[x]++;
  const scores = new Array(46).fill(0);
  for (let i = 1; i <= 45; i++) {
    const pLong = ctx.freq[i] / ctx.n;
    const pRec = rf[i] / recN;
    const hot = pRec;
    const cold = Math.max(0, pLong - pRec);
    scores[i] = hot * 0.6 + cold * 0.4;
  }
  const sumPred = predicted.reduce((a, n) => a + scores[n], 0);
  const allMean = scores.slice(1).reduce((a, b) => a + b, 0) / 45;
  const expRandom = 6 * allMean;
  if (expRandom === 0) return 1;
  return sumPred / expRandom;
}

// dispatcher
export function fidelity(algoId, predicted, ctx) {
  switch (algoId) {
    case "freq": return freqFidelity(predicted, ctx);
    case "cooccur": return cooccurFidelity(predicted, ctx);
    case "monte": return monteFidelity(predicted, ctx);
    case "delta": return deltaFidelity(predicted, ctx);
    case "genetic": return geneticFidelity(predicted, ctx);
    case "hotcold": return hotcoldFidelity(predicted, ctx);
    default: return NaN;
  }
}

// 무작위 baseline 기준값 (해석용)
export const FIDELITY_BASELINE = {
  freq: 0,        // z=0 (무작위 6개 평균 빈도가 전체 평균과 동일)
  cooccur: 1,     // ratio=1 (무작위 pair와 동일)
  monte: 1,
  delta: null,    // 무작위 6개 gaps의 RMSE는 분포라 단일 값 없음. 별도 측정
  genetic: 0.5,   // percentile 50
  hotcold: 1,     // ratio=1
};
