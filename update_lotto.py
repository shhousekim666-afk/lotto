#!/usr/bin/env python3
import json
import re
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

HTML = Path(__file__).parent / "index.html"
API = "https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo={n}"
HEADERS = {"User-Agent": "Mozilla/5.0"}
TIMEOUT = 15


def fetch(n: int):
    req = urllib.request.Request(API.format(n=n), headers=HEADERS)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        data = json.loads(r.read().decode("utf-8"))
    if data.get("returnValue") != "success":
        return None
    return {
        "no": data["drwNo"],
        "date": data["drwNoDate"],
        "nums": [data[f"drwtNo{i}"] for i in range(1, 7)],
        "bonus": data["bnusNo"],
    }


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

    new_rows = []
    n = last_round + 1
    while True:
        try:
            row = fetch(n)
        except Exception as e:
            print(f"fetch {n} failed: {e}", file=sys.stderr)
            break
        if row is None:
            print(f"round {n} not yet drawn")
            break
        print(f"fetched {n}: {row['date']} {row['nums']}+{row['bonus']}")
        new_rows.append(row)
        n += 1

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
    print(f"updated to {total} (+{len(new_rows)} rounds)")

    repo_dir = HTML.parent
    msg = f"data: {total}회 갱신 (+{len(new_rows)})"
    for cmd in (
        ["git", "add", "index.html"],
        ["git", "commit", "-m", msg],
        ["git", "push"],
    ):
        r = subprocess.run(cmd, cwd=repo_dir, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"git {cmd[1]} failed: {r.stderr.strip()}", file=sys.stderr)
            return
    print("pushed to origin")


if __name__ == "__main__":
    main()
