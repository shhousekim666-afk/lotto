// 번호별 사후확률과 번호 쌍의 공출현 lift를 결합한 공동분포 점수 모델.
// 점수는 조합 간 상대 비교용이며, 공정 추첨의 실제 확률을 대체하지 않는다.
import { NUMBER_BASELINE, LOTTO_NUMBERS, PICKS } from './probability-baseline.js';
import { buildBayesianFrequencyModel } from './bayesian-pattern.js';

function randomPick(rng) {
  const pool = Array.from({ length: LOTTO_NUMBERS }, (_, index) => index + 1);
  const result = [];
  while (result.length < PICKS) result.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return result.sort((a, b) => a - b);
}

export function buildJointPatternModel(draws, options = {}) {
  const frequency = buildBayesianFrequencyModel(draws, options);
  const cooccur = Array.from({ length: LOTTO_NUMBERS + 1 }, () => new Array(LOTTO_NUMBERS + 1).fill(0));
  for (const draw of draws) {
    for (const a of draw.nums) for (const b of draw.nums) if (a !== b) cooccur[a][b]++;
  }
  const expectedPair = draws.length * PICKS * (PICKS - 1) / (LOTTO_NUMBERS * (LOTTO_NUMBERS - 1));
  const smoothing = options.smoothing ?? 1;
  const pairLift = Array.from({ length: LOTTO_NUMBERS + 1 }, () => new Array(LOTTO_NUMBERS + 1).fill(1));
  for (let a = 1; a <= LOTTO_NUMBERS; a++) {
    for (let b = a + 1; b <= LOTTO_NUMBERS; b++) {
      const lift = (cooccur[a][b] + smoothing) / (expectedPair + smoothing);
      pairLift[a][b] = lift;
      pairLift[b][a] = lift;
    }
  }
  return { ...frequency, cooccur, pairLift, pairWeight: options.pairWeight ?? 0.35 };
}

export function jointScore(numbers, model) {
  const selected = new Set(numbers);
  if (selected.size !== PICKS || numbers.some((number) => number < 1 || number > LOTTO_NUMBERS)) return 0;
  let logScore = 0;
  for (const number of numbers) {
    const item = model.numbers[number - 1];
    logScore += Math.log(item.probability / NUMBER_BASELINE);
  }
  for (let i = 0; i < numbers.length; i++) {
    for (let j = i + 1; j < numbers.length; j++) {
      logScore += model.pairWeight * Math.log(model.pairLift[numbers[i]][numbers[j]]);
    }
  }
  return Math.exp(logScore);
}

export function generateJointPick(model, rng = Math.random, candidates = 10000) {
  let best = null;
  for (let i = 0; i < candidates; i++) {
    const numbers = randomPick(rng);
    const score = jointScore(numbers, model);
    if (!best || score > best.score) best = { numbers, score };
  }
  return best;
}
