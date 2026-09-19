import { readFileSync } from 'node:fs';
import { loadDraws } from './data-loader.js';
import { EVALUATION_VERSION } from './evaluator.js';

const latest = loadDraws().length;
const strict = process.argv.includes('--current');
const read = name => JSON.parse(readFileSync(new URL(`./${name}-summary.json`, import.meta.url), 'utf8'));
function check(ok, message) { if (!ok) throw new Error(message); }
function finiteTree(value) {
  if (typeof value === 'number') check(Number.isFinite(value), '유한하지 않은 결과');
  if (value && typeof value === 'object') Object.values(value).forEach(finiteTree);
}
const summary = read('backtest');
check(summary.meta.evaluationVersion === EVALUATION_VERSION, '백테스트 검증 방식이 오래되었습니다.');
for (const [name, data, end] of [
  ['backtest', summary, summary.meta.evalEnd],
  ['bayesian', read('bayesian-backtest'), read('bayesian-backtest').meta.evalEnd],
  ['sweep', read('sweep'), read('sweep').meta.holdoutRange[1]],
  ['stability', read('stability'), read('stability').meta.weekRange[1]],
]) {
  finiteTree(data);
  check(Number.isInteger(end) && end <= latest, `${name}: DB보다 미래 결과입니다.`);
  if (strict && !(name==='sweep' && process.argv.includes('--allow-stale-sweep'))) check(end === latest, `${name}: 최신 DB ${latest}회와 평가 ${end}회 불일치`);
  if (end < latest) console.warn(`${name}: ${end}회까지 평가. DB ${latest}회, 재계산 필요`);
}
check(Object.keys(summary.algos).length === 6, '알고리즘 누락');
for (const s of Object.values(summary.algos)) {
  for (const key of ['bss','hitMean','hitStd','meanBS','meanBSRef','pValue','pValueBonferroni','evalRounds']) check(typeof s[key]==='number' && Number.isFinite(s[key]), `${key}: 숫자 누락`);
  check(s.pValue > 0 && s.pValue <= 1, 'p값 범위 오류');
  check(s.pValueBonferroni >= s.pValue && s.pValueBonferroni <= 1, '보정 p값 오류');
  check(s.isSignificant === (s.bss > 0 && s.pValueBonferroni < 0.05), '유의성 표시 오류');
  check(s.hitDist.reduce((a,b)=>a+b,0) === s.evalRounds, '적중 분포 회차 불일치');
}
const sweep=read('sweep');
check(sweep.meta.selectionVersion === 2, '설정 선택 방식이 오래되었습니다.');
for(const a of Object.values(sweep.algos)) check(a.best.trainMean===Math.max(...a.trials.map(t=>t.trainMean)), '설정 선택이 선택 구간 성적과 다릅니다.');
finiteTree(read('fidelity'));
console.log('결과 파일 검증 통과');
