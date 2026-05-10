#!/usr/bin/env python3
import html
import re
import sys
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

HTML = Path(__file__).parent / "index.html"
NAMU_URL = "https://namu.wiki/w/%EB%A1%9C%EB%98%90%206/45/%EB%8B%B9%EC%B2%A8%EB%B2%88%ED%98%B8/2020%EB%85%84%EB%8C%80"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
TIMEOUT = 30
ROUND_PATTERN = re.compile(
    r'\|(\d{3,4})\|(\d{1,2})\|(\d{1,2})\|(\d{1,2})\|(\d{1,2})\|(\d{1,2})\|(\d{1,2})\|(\d{1,2})\|(20\d{2})년\|\s*\|(\d{1,2})월\s*(\d{1,2})일\|'
)


def fetch_namu_rounds() -> dict:
    req = urllib.request.Request(NAMU_URL, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        text = r.read().decode("utf-8")
    clean = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL)
    clean = re.sub(r'<[^>]+>', '|', clean)
    clean = html.unescape(clean)
    clean = re.sub(r'\|+', '|', clean)
    clean = re.sub(r'\s+', ' ', clean)
    rounds = {}
    for m in ROUND_PATTERN.finditer(clean):
        rnd = int(m.group(1))
        nums = [int(m.group(i)) for i in range(2, 9)]
        yr, mo, dy = int(m.group(9)), int(m.group(10)), int(m.group(11))
        if not all(1 <= n <= 45 for n in nums):
            continue
        rounds[rnd] = {
            "no": rnd,
            "date": f"{yr}-{mo:02d}-{dy:02d}",
            "nums": sorted(nums[:6]),
            "bonus": nums[6],
        }
    return rounds


def next_saturday(after: str) -> str:
    d = datetime.strptime(after, "%Y-%m-%d")
    return (d + timedelta(days=7)).strftime("%Y년 %-m월 %-d일")


def main():
    text = HTML.read_text(encoding="utf-8")
    raw_match = re.search(r"const RAW\s*=\s*\[(.*?)\];", text, flags=re.DOTALL)
    if not raw_match:
        print("RAW array not found", file=sys.stderr)
        sys.exit(1)
    last_round = max(int(m.group(1)) for m in re.finditer(r"\[(\d+),", raw_match.group(1)))
    print(f"current latest: {last_round}")

    try:
        namu = fetch_namu_rounds()
    except Exception as e:
        print(f"namu fetch failed: {e}", file=sys.stderr)
        sys.exit(1)
    print(f"namu rounds: {min(namu)}~{max(namu)} ({len(namu)} entries)")

    new_rows = [namu[r] for r in sorted(namu) if r > last_round]
    if not new_rows:
        print("nothing to update")
        return

    addition = "," + ",".join(
        f"[{r['no']},\"{r['date']}\",{','.join(str(x) for x in r['nums'])},{r['bonus']}]"
        for r in new_rows
    )
    text = text[: raw_match.end() - 2] + addition + text[raw_match.end() - 2 :]

    latest = new_rows[-1]
    total = latest["no"]
    pretty = f"{total:,}"
    next_no = total + 1
    next_date_str = next_saturday(latest["date"])
    chip_date = latest["date"].replace("-", ".")

    text = re.sub(r'1~\d+회 실제 데이터', f'1~{total}회 실제 데이터', text)
    text = re.sub(r'\d{4}\.\d{2}\.\d{2} 최신', f'{chip_date} 최신', text)
    text = re.sub(r'\d{1,3}(?:,\d{3})*회차 실제 당첨', f'{pretty}회차 실제 당첨', text)
    text = re.sub(r'<span class="hl">제 \d+회</span>', f'<span class="hl">제 {next_no}회</span>', text)
    text = re.sub(
        r'<span class="dim">\d{4}년 \d{1,2}월 \d{1,2}일 \(토\) 오후 8:45</span>',
        f'<span class="dim">{next_date_str} (토) 오후 8:45</span>',
        text,
    )
    text = re.sub(r'\(1~\d+회\)', f'(1~{total}회)', text)
    text = re.sub(r'const N = DRAWS\.length; // \d+', f'const N = DRAWS.length; // {total}', text)
    text = re.sub(r"desc:'\d{1,3}(?:,\d{3})*회 경험적", f"desc:'{pretty}회 경험적", text)

    HTML.write_text(text, encoding="utf-8")
    added = ", ".join(str(r["no"]) for r in new_rows)
    print(f"updated to {total} (+{len(new_rows)} rounds: {added})")


if __name__ == "__main__":
    main()
