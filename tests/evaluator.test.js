import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNullPValue, computeRoundBS, applyBonferroni } from '../backtest/evaluator.js';
import { mulberry32, buildContext, algoFreq } from '../backtest/algo-adapter.js';
import { parseDraws, loadDraws } from '../backtest/data-loader.js';
import { validate } from '../backtest/validate-data.js';

test('균등 기준 자체와 악화된 예측은 우위가 아니다', () => {
  const actual = Array.from({length:100},()=>Float64Array.from({length:45},(_,i)=>i<6?1:0));
  const pred = actual.map(()=>new Float64Array(45).fill(6/45));
  assert.equal(computeNullPValue(computeRoundBS(pred, actual)).pValue,1);
  assert.equal(computeNullPValue({bs:[0.2,0.3],bsRef:[0.1,0.1]}).pValue,1);
});
test('개선 검정은 재현 가능하고 0인 p값을 만들지 않는다', () => {
  const args={bs:[0.01,0.02,0.03,0.02],bsRef:[0.1,0.1,0.1,0.1],nSim:999};
  const a=computeNullPValue({...args,rng:mulberry32(1)});
  assert.equal(a.pValue,0.001);
  assert.deepEqual(a,computeNullPValue({...args,rng:mulberry32(1)}));
  const summaries=[{bss:-0.2,pValue:0.001},{bss:0.2,pValue:0.001}];
  applyBonferroni(summaries);
  assert.equal(summaries[0].isSignificant,false);
  assert.equal(summaries[1].isSignificant,true);
});
test('잘못된 RAW 행을 조용히 버리지 않는다', () => {
  assert.throws(()=>parseDraws('const RAW = [[1,"2002-12-07",1,2,3,4,5,6,7], broken];'));
  assert.throws(()=>parseDraws('const RAW = [];'));
  const draws=loadDraws();
  assert.deepEqual(validate(draws),[]);
  const invalid=structuredClone(draws.slice(0,2));
  invalid[1].date='2002-12-15';
  assert.ok(validate(invalid).length);
  invalid[1].date='2002-02-30';
  assert.ok(validate(invalid).some(x=>x.includes('날짜가 잘못')));
});
test('빈도 탐색은 항상 6개를 반환하고 후보 5개는 거절한다', () => {
  const ctx=buildContext(loadDraws().slice(0,100));
  assert.throws(()=>algoFreq(ctx,mulberry32(1),{topK:5}));
  for(const topK of [6,10,12,15,20]) assert.equal(new Set(algoFreq(ctx,mulberry32(1),{topK})).size,6);
});
