// 6개 알고리즘을 (ctx, rng) → [n1..n6] 시그니처로 통일.
// 원본 index.html 함수 로직 그대로 옮기되 전역 의존만 ctx로, Math.random은 rng()로 교체.

// ━━━ PRNG ━━━
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// seed 합성: algoId 문자열 + round + runIdx → 32bit
export function seedFor(algoId, round, runIdx) {
  let h = 2166136261 >>> 0;
  const s = `${algoId}:${round}:${runIdx}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// ━━━ Context 사전계산 ━━━
export function buildContext(draws) {
  const n = draws.length;
  const freq = new Array(46).fill(0);
  for (const d of draws) for (const x of d.nums) freq[x]++;
  const totalPicks = freq.slice(1).reduce((a, b) => a + b, 0);

  const sums = draws.map((d) => d.nums.reduce((a, b) => a + b, 0));
  const avgSum = sums.reduce((a, b) => a + b, 0) / n;
  const stdSum = Math.sqrt(sums.map((s) => (s - avgSum) ** 2).reduce((a, b) => a + b, 0) / n);

  const oddCnts = draws.map((d) => d.nums.filter((x) => x % 2 !== 0).length);
  const avgOdd = oddCnts.reduce((a, b) => a + b, 0) / n;
  const stdOdd = Math.sqrt(oddCnts.map((o) => (o - avgOdd) ** 2).reduce((a, b) => a + b, 0) / n);

  const co = Array.from({ length: 46 }, () => new Array(46).fill(0));
  for (const d of draws) {
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if (i !== j) co[d.nums[i]][d.nums[j]]++;
  }
  const coSum = new Array(46).fill(0);
  for (let i = 1; i <= 45; i++) coSum[i] = co[i].slice(1).reduce((a, b) => a + b, 0);
  let maxCoPair = 0;
  for (let i = 1; i <= 45; i++)
    for (let j = 1; j <= 45; j++) if (i !== j && co[i][j] > maxCoPair) maxCoPair = co[i][j];

  const deltaAvg = [0, 0, 0, 0, 0];
  for (const d of draws) {
    const s = [...d.nums].sort((a, b) => a - b);
    for (let i = 0; i < 5; i++) deltaAvg[i] += s[i + 1] - s[i];
  }
  for (let i = 0; i < 5; i++) deltaAvg[i] /= n;

  return { draws, n, freq, totalPicks, avgSum, stdSum, avgOdd, stdOdd, co, coSum, maxCoPair, deltaAvg };
}

// ━━━ 헬퍼 ━━━
function wSample(weights, rng) {
  const t = weights.reduce((a, b) => a + b, 0);
  let r = rng() * t;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

// ━━━ 알고리즘 1: 빈도 분석 ━━━
export function algoFreq(ctx, rng, opts = {}) {
  const { freq } = ctx;
  const topK = opts.topK ?? 12;
  const topN = Array.from({ length: 45 }, (_, i) => i + 1)
    .sort((a, b) => freq[b] - freq[a])
    .slice(0, topK);
  const w = topN.map((n) => freq[n] ** 2);
  const chosen = new Set();
  let t = 0;
  while (chosen.size < 6 && t++ < 400) chosen.add(topN[wSample(w, rng)]);
  for (const n of topN) {
    if (chosen.size >= 6) break;
    chosen.add(n);
  }
  return [...chosen].sort((a, b) => a - b);
}

// ━━━ 알고리즘 2: 공출현 행렬 가중 샘플링 ━━━
// 변경: 그리디 1세트 → 사후분포(공출현 점수²) 가중 샘플링
// 1번째: coSum top-6 중 coSum² 가중 / 이후: 기선택과의 평균 공출현 top-6 중 가중
export function algoCooccur(ctx, rng, opts = {}) {
  const { co, coSum } = ctx;
  const TOP_K = opts.topK ?? 6;
  const all = Array.from({ length: 45 }, (_, i) => i + 1);
  const top1 = [...all].sort((a, b) => coSum[b] - coSum[a]).slice(0, TOP_K);
  const w1 = top1.map((n) => coSum[n] ** 2);
  const chosen = [top1[wSample(w1, rng)]];
  while (chosen.length < 6) {
    const candidates = all.filter((n) => !chosen.includes(n));
    const scored = candidates
      .map((n) => ({ n, s: chosen.reduce((a, c) => a + co[n][c], 0) / chosen.length }))
      .sort((a, b) => b.s - a.s);
    const topK = scored.slice(0, Math.min(TOP_K, scored.length));
    const weights = topK.map((x) => x.s ** 2);
    if (weights.every((w) => w === 0)) {
      chosen.push(topK[0].n);
    } else {
      chosen.push(topK[wSample(weights, rng)].n);
    }
  }
  return chosen.sort((a, b) => a - b);
}

// ━━━ 알고리즘 3: 몬테카를로 ━━━
export function algoMonte(ctx, rng, opts = {}) {
  const { freq, co } = ctx;
  const SIMS = opts.sims ?? 100000;
  let bestCombo = null,
    bestScore = -1;
  const allNums = Array.from({ length: 45 }, (_, i) => i + 1);
  const fw = allNums.map((n) => freq[n]);
  for (let i = 0; i < SIMS; i++) {
    const combo = [];
    const avail = [...allNums];
    const aw = [...fw];
    for (let k = 0; k < 6; k++) {
      const idx = wSample(aw, rng);
      combo.push(avail[idx]);
      avail.splice(idx, 1);
      aw.splice(idx, 1);
    }
    let score = 0;
    for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) if (a !== b) score += co[combo[a]][combo[b]];
    if (score > bestScore) {
      bestScore = score;
      bestCombo = combo;
    }
  }
  return bestCombo.sort((a, b) => a - b);
}

// ━━━ 알고리즘 4: 델타 수열 + 시작번호 가중 샘플링 ━━━
// 변경: 시작번호 = 최빈 1개 → 최솟값 빈도 top-5 (1~5번) 중 빈도² 가중 샘플
// 평균 델타는 그대로 유지 (이론 보존)
export function algoDelta(ctx, rng, opts = {}) {
  const { draws, deltaAvg, freq } = ctx;
  const startFreq = new Array(8).fill(0);
  for (const d of draws) {
    const mn = Math.min(...d.nums);
    if (mn <= 7) startFreq[mn]++;
  }
  const startCands = opts.startCands ?? [1, 2, 3, 4, 5];
  const startW = startCands.map((n) => Math.max(1, startFreq[n]) ** 2);
  const startNum = startCands[wSample(startW, rng)];
  const nums = [startNum];
  for (let i = 0; i < 5; i++)
    nums.push(Math.min(45, Math.round(nums[nums.length - 1] + deltaAvg[i])));
  const unique = [...new Set(nums.filter((n) => n >= 1 && n <= 45))].slice(0, 6);
  if (unique.length < 6) {
    const ranked = Array.from({ length: 45 }, (_, i) => i + 1).sort((a, b) => freq[b] - freq[a]);
    for (const n of ranked) {
      if (unique.length >= 6) break;
      if (!unique.includes(n)) unique.push(n);
    }
  }
  return unique.sort((a, b) => a - b);
}

// ━━━ 알고리즘 5: 유전 알고리즘 ━━━
export function algoGenetic(ctx, rng, opts = {}) {
  const { freq, totalPicks, avgSum, stdSum, avgOdd, stdOdd } = ctx;
  const gens = opts.gens ?? 80;
  const popSize = opts.popSize ?? 120;
  const eliteSize = Math.max(1, Math.floor(popSize * 0.25));
  const avgF6 = (totalPicks / 45) * 6;
  function fitness(ind) {
    const fs = ind.reduce((a, n) => a + freq[n], 0);
    const s = ind.reduce((a, b) => a + b, 0);
    const o = ind.filter((n) => n % 2 !== 0).length;
    const pSum = ((s - avgSum) / stdSum) ** 2 * avgF6 * 0.05;
    const pOdd = ((o - avgOdd) / stdOdd) ** 2 * avgF6 * 0.05;
    return fs - pSum - pOdd;
  }
  const rndInd = () => {
    const s = new Set();
    while (s.size < 6) s.add(((rng() * 45) | 0) + 1);
    return [...s];
  };
  const cross = (a, b) => {
    const u = [...new Set([...a, ...b])];
    const s = new Set();
    while (s.size < 6) s.add(u[(rng() * u.length) | 0]);
    return [...s];
  };
  const mutate = (ind) => {
    const n = [...ind];
    let v;
    do {
      v = ((rng() * 45) | 0) + 1;
    } while (n.includes(v));
    n[(rng() * 6) | 0] = v;
    return n;
  };
  let pop = Array.from({ length: popSize }, rndInd);
  for (let g = 0; g < gens; g++) {
    pop.sort((a, b) => fitness(b) - fitness(a));
    const top = pop.slice(0, eliteSize);
    const next = [...top];
    while (next.length < popSize) {
      let c = cross(top[(rng() * top.length) | 0], top[(rng() * top.length) | 0]);
      if (rng() < 0.15) c = mutate(c);
      next.push(c);
    }
    pop = next;
  }
  // 진화 후 top-K unique 중 fitness² 가중 샘플링 (수렴 후 다양성 확보)
  pop.sort((a, b) => fitness(b) - fitness(a));
  const PICK_K = opts.pickK ?? 10;
  const uniq = [];
  const seen = new Set();
  for (const ind of pop) {
    const sorted = [...ind].sort((a, b) => a - b);
    const key = sorted.join(",");
    if (!seen.has(key)) {
      seen.add(key);
      uniq.push(sorted);
      if (uniq.length >= PICK_K) break;
    }
  }
  const weights = uniq.map((ind) => {
    const f = fitness(ind);
    return Math.max(0.001, f) ** 2;
  });
  return uniq[wSample(weights, rng)];
}

// ━━━ 알고리즘 6: 핫/콜드 + 점수 가중 샘플링 ━━━
// 변경: top 6 정렬 선택 → top-12 중 점수² 가중 비복원 추출 (freq와 동일 패턴)
export function algoHotCold(ctx, rng, opts = {}) {
  const { draws, freq, n } = ctx;
  const window = opts.window ?? 50;
  const TOP_K = opts.topK ?? 12;
  const recent = draws.slice(-Math.min(window, draws.length));
  const rf = new Array(46).fill(0);
  for (const d of recent) for (const x of d.nums) rf[x]++;
  const recN = recent.length;
  const scores = new Array(46).fill(0);
  for (let i = 1; i <= 45; i++) {
    const pLong = freq[i] / n;
    const pRec = rf[i] / recN;
    const hot = pRec;
    const cold = Math.max(0, pLong - pRec);
    scores[i] = hot * 0.6 + cold * 0.4;
  }
  const ranked = Array.from({ length: 45 }, (_, i) => i + 1).sort((a, b) => scores[b] - scores[a]);
  const topK = ranked.slice(0, TOP_K);
  const weights = topK.map((n) => scores[n] ** 2);
  const chosen = new Set();
  let t = 0;
  while (chosen.size < 6 && t++ < 400) chosen.add(topK[wSample(weights, rng)]);
  for (const n of topK) {
    if (chosen.size >= 6) break;
    chosen.add(n);
  }
  return [...chosen].sort((a, b) => a - b);
}

// 알고리즘 카탈로그
export const ALGOS = [
  { id: "freq", name: "빈도 분석", det: false, fn: algoFreq },
  { id: "cooccur", name: "공출현 행렬", det: false, fn: algoCooccur },
  { id: "monte", name: "몬테카를로", det: false, fn: algoMonte },
  { id: "delta", name: "델타 수열", det: false, fn: algoDelta },
  { id: "genetic", name: "유전 알고리즘", det: false, fn: algoGenetic },
  { id: "hotcold", name: "핫/콜드", det: false, fn: algoHotCold },
];
