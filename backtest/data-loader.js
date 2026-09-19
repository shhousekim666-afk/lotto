// index.html의 RAW 배열에서 회차 데이터 추출

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = resolve(__dirname, "..", "index.html");

export function loadDraws(path = HTML) {
  return parseDraws(readFileSync(path, "utf-8"));
}

export function parseDraws(text) {
  const m = text.match(/const RAW\s*=\s*\[(.*?)\];/s);
  if (!m) throw new Error("RAW array not found in index.html");

  const rows = JSON.parse(`[${m[1]}]`);
  if (!Array.isArray(rows) || !rows.length) throw new Error('당첨 데이터가 비어 있습니다.');
  return rows.map(row => {
    if (!Array.isArray(row) || row.length !== 9) throw new Error('각 회차는 정확히 9개 값이어야 합니다.');
    return {no: row[0], date: row[1], nums: row.slice(2, 8), bonus: row[8]};
  });
}
