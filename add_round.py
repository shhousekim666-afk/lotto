#!/usr/bin/env python3
"""수동으로 한 회차 데이터를 index.html에 추가.

사용:
  python add_round.py "회차,YYYY-MM-DD,n1,n2,n3,n4,n5,n6,보너스"
  python add_round.py "1225,2026-05-23,1,2,3,4,5,6,7"
"""
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

HTML = Path(__file__).parent / "index.html"


def next_saturday(after: str) -> str:
    d = datetime.strptime(after, "%Y-%m-%d")
    return (d + timedelta(days=7)).strftime("%Y년 %-m월 %-d일")


def parse_input(raw: str) -> dict:
    parts = [p.strip() for p in raw.split(",")]
    if len(parts) != 9:
        raise ValueError(f"입력 형식 오류: 9개 값 필요, {len(parts)}개 받음")
    rnd = int(parts[0])
    date = parts[1]
    datetime.strptime(date, "%Y-%m-%d")
    nums = [int(x) for x in parts[2:8]]
    bonus = int(parts[8])
    all_nums = nums + [bonus]
    if not all(1 <= n <= 45 for n in all_nums):
        raise ValueError(f"번호는 1~45 범위여야 함: {all_nums}")
    if len(set(all_nums)) != 7:
        raise ValueError(f"7개 번호가 모두 달라야 함: {all_nums}")
    return {"no": rnd, "date": date, "nums": sorted(nums), "bonus": bonus}


def main():
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        sys.exit(1)
    row = parse_input(sys.argv[1])

    text = HTML.read_text(encoding="utf-8")
    raw_match = re.search(r"const RAW\s*=\s*\[(.*?)\];", text, flags=re.DOTALL)
    if not raw_match:
        print("RAW array not found", file=sys.stderr)
        sys.exit(1)

    existing = {int(m.group(1)) for m in re.finditer(r"\[(\d+),", raw_match.group(1))}
    last_round = max(existing)
    if row["no"] in existing:
        print(f"{row['no']}회 이미 존재. 종료.")
        return
    if row["no"] != last_round + 1:
        print(f"경고: 마지막 {last_round}회 다음은 {last_round + 1}회인데 {row['no']}회 입력됨", file=sys.stderr)

    addition = f",[{row['no']},\"{row['date']}\",{','.join(str(x) for x in row['nums'])},{row['bonus']}]"
    text = text[: raw_match.end() - 2] + addition + text[raw_match.end() - 2 :]

    total = row["no"]
    pretty = f"{total:,}"
    next_no = total + 1
    next_date_str = next_saturday(row["date"])
    chip_date = row["date"].replace("-", ".")

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
    print(f"updated to {total}: {row['date']} {row['nums']} + {row['bonus']}")


if __name__ == "__main__":
    main()
