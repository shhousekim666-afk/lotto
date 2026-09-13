// 공정한 로또 6/45의 기준 확률.
// 모델이 산출한 상대확률은 반드시 이 기준과 함께 해석한다.
export const LOTTO_NUMBERS = 45;
export const PICKS = 6;
export const NUMBER_BASELINE = PICKS / LOTTO_NUMBERS;
export const COMBINATION_COUNT = combination(LOTTO_NUMBERS, PICKS);
export const COMBINATION_BASELINE = 1 / COMBINATION_COUNT;

function combination(n, k) {
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

export function combinationProbability(matchCount) {
  if (!Number.isInteger(matchCount) || matchCount < 0 || matchCount > PICKS) return 0;
  const ways = combination(PICKS, matchCount) * combination(LOTTO_NUMBERS - PICKS, PICKS - matchCount);
  return ways / COMBINATION_COUNT;
}

export function baselineSummary() {
  return {
    numberProbability: NUMBER_BASELINE,
    combinationCount: COMBINATION_COUNT,
    combinationProbability: COMBINATION_BASELINE,
    matchDistribution: Array.from({ length: PICKS + 1 }, (_, matchCount) => ({
      matchCount,
      probability: combinationProbability(matchCount),
    })),
  };
}
