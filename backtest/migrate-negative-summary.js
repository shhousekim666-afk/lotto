// 기존 예측을 재실행한 것으로 표시하지 않고, 음수 BSS의 잘못된 유의성만 교정한다.
import { readFileSync, writeFileSync } from 'node:fs';
import { applyBonferroni, EVALUATION_VERSION } from './evaluator.js';
const path = new URL('./backtest-summary.json', import.meta.url);
const data = JSON.parse(readFileSync(path, 'utf8'));
if (data.meta.evaluationVersion === EVALUATION_VERSION) throw new Error('이미 교정된 결과입니다.');
for (const s of Object.values(data.algos)) {
  if (!(s.meanBS >= s.meanBSRef && s.bss <= 0)) throw new Error('양수 BSS는 원본 예측으로 재계산해야 합니다.');
  s.pValue = 1;
  s.nullSimCount = 0;
}
applyBonferroni(Object.values(data.algos));
Object.assign(data.meta, {
  evaluationVersion: EVALUATION_VERSION,
  significanceMethod: 'paired-centered-bootstrap-one-sided',
  inferenceCorrectedAt: new Date().toISOString(),
  hitStdDefinition: 'round-mean',
  correctionNote: '기존 적중 수·BSS·CI 보존. BSS가 모두 음수이므로 개선에 대한 단측 p=1로 교정. 예측을 재실행한 결과는 아닙니다.',
});
writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
