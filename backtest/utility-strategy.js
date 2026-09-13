// 당첨확률이 아니라 당첨 시 공동당첨 위험을 낮추는 선택 전략.
const ALL_NUMBERS = Array.from({ length: 45 }, (_, index) => index + 1);

function randomPick(rng) {
  const pool = [...ALL_NUMBERS];
  const result = [];
  while (result.length < 6) result.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return result.sort((a, b) => a - b);
}

export function crowdScore(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  let score = sorted.filter((number) => number <= 31).length * 0.8;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] === 1) score += 1.2;
    if (sorted[i] % 10 === sorted[i - 1] % 10) score += 0.7;
  }
  if (sorted.every((number) => number <= 31)) score += 1.5;
  return score;
}

export function generateUtilityPick(rng = Math.random, candidates = 5000) {
  let best = null;
  for (let i = 0; i < candidates; i++) {
    const numbers = randomPick(rng);
    const score = crowdScore(numbers);
    if (!best || score < best.crowdScore) best = { numbers, crowdScore: score };
  }
  return { ...best, winProbability: 1 / 8145060, payoutIndex: 1 / (1 + best.crowdScore) };
}

function overlap(a, b) {
  const set = new Set(b);
  return a.filter((number) => set.has(number)).length;
}

export function generateDiversifiedPicks(count = 5, rng = Math.random, candidates = 3000) {
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('추천 장수는 1~20 사이여야 합니다.');
  const picks = [];
  while (picks.length < count) {
    let best = null;
    for (let i = 0; i < candidates; i++) {
      const numbers = randomPick(rng);
      const maxOverlap = picks.length ? Math.max(...picks.map((pick) => overlap(numbers, pick))) : 0;
      const totalOverlap = picks.reduce((sum, pick) => sum + overlap(numbers, pick), 0);
      const score = maxOverlap * 10 + totalOverlap;
      if (!best || score < best.score) best = { numbers, score };
    }
    picks.push(best.numbers);
  }
  return picks;
}
