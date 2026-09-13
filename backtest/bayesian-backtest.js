// 베이지안 번호 모델의 워크포워드 검증.
// 각 회차의 실제 당첨번호는 해당 회차를 예측할 때 학습 데이터에 포함하지 않는다.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDraws } from './data-loader.js';
import { buildBayesianFrequencyModel } from './bayesian-pattern.js';
import { buildJointPatternModel, generateJointPick } from './joint-pattern.js';
import { NUMBER_BASELINE } from './probability-baseline.js';
import { mulberry32, seedFor } from './algo-adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, 'bayesian-backtest-summary.json');

function parseArgs(argv, total) {
  const args = { start: 301, end: total, priorStrength: 45 };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--start') args.start = +value, i++;
    else if (key === '--end') args.end = +value, i++;
    else if (key === '--prior-strength') args.priorStrength = +value, i++;
  }
  if (!Number.isInteger(args.start) || !Number.isInteger(args.end) || args.start < 50 || args.end < args.start) {
    throw new Error('잘못된 회차 범위');
  }
  return args;
}

function binaryLogLoss(probability, observed) {
  const epsilon = 1e-12;
  const p = Math.min(1 - epsilon, Math.max(epsilon, probability));
  return -(observed ? Math.log(p) : Math.log(1 - p));
}

function main() {
  const draws = loadDraws();
  const args = parseArgs(process.argv, draws.length);
  const end = Math.min(args.end, draws.length);
  const hits = [];
  const jointHits = [];
  const logLosses = [];

  for (let round = args.start; round <= end; round++) {
    const model = buildBayesianFrequencyModel(draws.slice(0, round - 1), {
      priorStrength: args.priorStrength,
    });
    const jointModel = buildJointPatternModel(draws.slice(0, round - 1), {
      priorStrength: args.priorStrength,
    });
    const actual = new Set(draws[round - 1].nums);
    const prediction = model.topNumbers.slice(0, 6).map((item) => item.number);
    const jointPrediction = generateJointPick(jointModel, mulberry32(seedFor('joint-pattern', round, 0)), 3000).numbers;
    const hitCount = prediction.filter((number) => actual.has(number)).length;
    const jointHitCount = jointPrediction.filter((number) => actual.has(number)).length;
    let modelLoss = 0;
    let baselineLoss = 0;
    for (const item of model.numbers) {
      modelLoss += binaryLogLoss(item.probability, actual.has(item.number));
      baselineLoss += binaryLogLoss(NUMBER_BASELINE, actual.has(item.number));
    }
    hits.push(hitCount);
    jointHits.push(jointHitCount);
    logLosses.push({ model: modelLoss / 45, baseline: baselineLoss / 45 });
  }

  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const hitMean = mean(hits);
  const jointHitMean = mean(jointHits);
  const modelLogLoss = mean(logLosses.map((value) => value.model));
  const baselineLogLoss = mean(logLosses.map((value) => value.baseline));
  const hitDistribution = Array.from({ length: 7 }, (_, count) => hits.filter((hit) => hit === count).length);
  const jointHitDistribution = Array.from({ length: 7 }, (_, count) => jointHits.filter((hit) => hit === count).length);
  const result = {
    meta: {
      generatedAt: new Date().toISOString(),
      totalDraws: draws.length,
      evalStart: args.start,
      evalEnd: end,
      evalRounds: hits.length,
      priorStrength: args.priorStrength,
    },
    model: {
      name: '베이지안 빈도 모델',
      hitMean: +hitMean.toFixed(4),
      randomExpectedHit: +(6 * NUMBER_BASELINE).toFixed(4),
      hitDistribution,
      joint: {
        name: '빈도+공출현 공동분포 모델',
        hitMean: +jointHitMean.toFixed(4),
        randomExpectedHit: +(6 * NUMBER_BASELINE).toFixed(4),
        hitDistribution: jointHitDistribution,
      },
      meanLogLoss: +modelLogLoss.toFixed(6),
      baselineLogLoss: +baselineLogLoss.toFixed(6),
      logLossSkill: +(1 - modelLogLoss / baselineLogLoss).toFixed(6),
    },
  };
  writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main();
