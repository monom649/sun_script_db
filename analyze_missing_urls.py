#!/usr/bin/env python3
import sqlite3
import re

# データベース接続
db_path = "/Users/mitsuruono/sunsun_script_search/sunsun_script_database/sun_script_db/sunsun_final_dialogue_database_with_urls.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# URLがない台本を全て取得
cursor.execute("""
    SELECT DISTINCT script_name 
    FROM dialogues 
    WHERE script_url IS NULL OR script_url = ''
    ORDER BY script_name
""")

missing_scripts = cursor.fetchall()
print(f"URLがない台本数: {len(missing_scripts)}")

# 管理番号を抽出して分析
missing_ids = []
other_patterns = []

for (script_name,) in missing_scripts:
    # B + 数字パターン
    match = re.match(r'^(B\d+)', script_name)
    if match:
        missing_ids.append(match.group(1))
    else:
        other_patterns.append(script_name)

print(f"\nB数字パターンで不足: {len(missing_ids)}件")
print(f"その他のパターン: {len(other_patterns)}件")

# B数字の範囲を確認
if missing_ids:
    numbers = [int(id[1:]) for id in missing_ids]  # Bを除去して数字のみ
    numbers.sort()
    
    print(f"\n不足している管理番号の範囲:")
    print(f"最小: B{min(numbers)}")
    print(f"最大: B{max(numbers)}")
    
    # 範囲を区切って表示
    ranges = []
    start = numbers[0]
    prev = numbers[0]
    
    for num in numbers[1:]:
        if num != prev + 1:  # 連続しない場合
            if start == prev:
                ranges.append(f"B{start}")
            else:
                ranges.append(f"B{start}-B{prev}")
            start = num
        prev = num
    
    # 最後の範囲を追加
    if start == prev:
        ranges.append(f"B{start}")
    else:
        ranges.append(f"B{start}-B{prev}")
    
    print(f"\n不足している番号の範囲: {', '.join(ranges[:10])}")
    if len(ranges) > 10:
        print(f"... (他 {len(ranges)-10}個の範囲)")

# その他のパターンの例
if other_patterns:
    print(f"\nその他のパターン例:")
    for pattern in other_patterns[:10]:
        print(f"  {pattern}")

conn.close()