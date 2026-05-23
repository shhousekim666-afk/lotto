// index.html의 RAW 배열에서 회차 데이터 추출

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = resolve(__dirname, "..", "index.html");

export function loadDraws() {
  const text = readFileSync(HTML, "utf-8");
  const m = text.match(/const RAW\s*=\s*\[(.*?)\];/s);
  if (!m) throw new Error("RAW array not found in index.html");

  const draws = [];
  const re = /\[(\d+),"(\d{4}-\d{2}-\d{2})",(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\]/g;
  let row;
  while ((row = re.exec(m[1])) !== null) {
    draws.push({
      no: +row[1],
      date: row[2],
      nums: [+row[3], +row[4], +row[5], +row[6], +row[7], +row[8]],
      bonus: +row[9],
    });
  }
  draws.sort((a, b) => a.no - b.no);
  return draws;
}
