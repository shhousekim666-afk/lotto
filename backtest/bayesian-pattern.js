// 번호별 출현 여부를 베타-이항 모델로 추정한다.
// 사전분포의 평균은 공정한 6/45 추첨의 번호 포함 확률과 일치시킨다.
import { NUMBER_BASELINE, LOTTO_NUMBERS, PICKS } from './probability-baseline.js';

export function buildBayesianFrequencyModel(draws, options = {}) {
  const priorStrength = options.priorStrength ?? LOTTO_NUMBERS;
  const alpha = priorStrength * NUMBER_BASELINE;
  const beta = priorStrength * (1 - NUMBER_BASELINE);
  const counts = new Array(LOTTO_NUMBERS + 1).fill(0);

  for (const draw of draws) for (const number of draw.nums) counts[number]++;

  const numbers = Array.from({ length: LOTTO_NUMBERS }, (_, index) => {
    const number = index + 1;
    const successes = counts[number];
    const failures = draws.length - successes;
    const posteriorAlpha = alpha + successes;
    const posteriorBeta = beta + failures;
    const total = posteriorAlpha + posteriorBeta;
    const mean = posteriorAlpha / total;
    const variance = (posteriorAlpha * posteriorBeta) / (total ** 2 * (total + 1));
    const standardDeviation = Math.sqrt(variance);
    const interval = [
      Math.max(0, mean - 1.96 * standardDeviation),
      Math.min(1, mean + 1.96 * standardDeviation),
    ];

    return {
      number,
      count: successes,
      probability: mean,
      relativeIndex: mean / NUMBER_BASELINE,
      interval,
    };
  });

  return {
    draws: draws.length,
    priorStrength,
    alpha,
    beta,
    numbers,
    topNumbers: [...numbers].sort((a, b) => b.probability - a.probability),
  };
}

export function scoreCombination(numbers, model) {
  const selected = new Set(numbers);
  if (selected.size !== PICKS || numbers.some((number) => number < 1 || number > LOTTO_NUMBERS)) return 0;
  return numbers.reduce((score, number) => {
    const item = model.numbers[number - 1];
    return score * (item.probability / NUMBER_BASELINE);
  }, 1);
}
