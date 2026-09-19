// RAW 당첨 데이터의 구조·정합성 검증.
import { loadDraws } from './data-loader.js';
import { pathToFileURL } from 'node:url';

export function validate(draws) {
  const errors = [];
  if (!draws.length) return ['당첨 데이터가 비어 있습니다.'];
  for (let i = 0; i < draws.length; i++) {
    const draw = draws[i];
    const expectedRound = i + 1;
    if (draw.no !== expectedRound) errors.push(`${draw.no}회차가 ${expectedRound}번째 위치에 있습니다.`);
    const timestamp=Date.parse(draw.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draw.date) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0,10)!==draw.date) errors.push(`${draw.no}회차 날짜가 잘못되었습니다.`);
    if (new Set(draw.nums).size !== 6) errors.push(`${draw.no}회차 본번호가 중복됩니다.`);
    if (draw.nums.some((number) => !Number.isInteger(number) || number < 1 || number > 45)) errors.push(`${draw.no}회차 본번호 범위가 잘못되었습니다.`);
    if (!Number.isInteger(draw.bonus) || draw.bonus < 1 || draw.bonus > 45 || draw.nums.includes(draw.bonus)) errors.push(`${draw.no}회차 보너스 번호가 잘못되었습니다.`);
    if (i > 0 && draw.date <= draws[i - 1].date) errors.push(`${draw.no}회차 날짜가 이전 회차보다 빠르거나 같습니다.`);
    if (i > 0 && timestamp-Date.parse(draws[i-1].date)!==7*86400000) errors.push(`${draw.no}회차 날짜는 이전 회차 7일 후여야 합니다.`);
  }
  return errors;
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const draws = loadDraws();
  const errors = validate(draws);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`데이터 검증 통과: ${draws.length}회차 (${draws[0].date} ~ ${draws.at(-1).date})`);
  }
}
