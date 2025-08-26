#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import sqlite3
import re
import sys
import os

def extract_script_id_from_name(script_name):
    """台本名から管理番号を抽出"""
    # B1234 形式の管理番号を抽出
    match = re.match(r'^(B\d+)', script_name)
    if match:
        return match.group(1)
    return None

def load_csv_urls(csv_file_path, id_column, url_column, skip_rows=0):
    """CSVファイルから管理番号とURLのマッピングを読み込む"""
    url_mapping = {}
    
    try:
        with open(csv_file_path, 'r', encoding='utf-8') as f:
            # 指定行数をスキップ
            for _ in range(skip_rows):
                next(f)
            
            reader = csv.reader(f)
            for row in reader:
                try:
                    if len(row) > max(id_column, url_column):
                        management_id = row[id_column].strip()
                        script_url = row[url_column].strip()
                        
                        # 管理番号とURLが有効な場合のみ追加
                        if management_id and script_url and management_id.startswith('B'):
                            # URLがGoogleドキュメント/スプレッドシートの場合のみ
                            if 'docs.google.com' in script_url:
                                url_mapping[management_id] = script_url
                                print(f"Found: {management_id} -> {script_url[:50]}...")
                except IndexError:
                    continue
                except Exception as e:
                    print(f"Error processing row: {e}")
                    continue
    except FileNotFoundError:
        print(f"File not found: {csv_file_path}")
        return {}
    except Exception as e:
        print(f"Error reading CSV file: {e}")
        return {}
    
    return url_mapping

def update_database_with_urls(db_path, url_mapping):
    """データベースのscript_urlフィールドを更新"""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # まず現在のデータを確認
    cursor.execute("SELECT DISTINCT script_name FROM dialogues")
    scripts = cursor.fetchall()
    
    updated_count = 0
    matched_count = 0
    
    for (script_name,) in scripts:
        management_id = extract_script_id_from_name(script_name)
        
        if management_id and management_id in url_mapping:
            script_url = url_mapping[management_id]
            matched_count += 1
            
            # script_urlを更新
            cursor.execute("""
                UPDATE dialogues 
                SET script_url = ? 
                WHERE script_name = ?
            """, (script_url, script_name))
            
            updated_count += cursor.rowcount
            print(f"Updated {script_name}: {script_url[:50]}...")
    
    conn.commit()
    
    # 更新結果を確認
    cursor.execute("SELECT COUNT(DISTINCT script_name) FROM dialogues WHERE script_url IS NOT NULL AND script_url != ''")
    total_with_urls = cursor.fetchone()[0]
    
    conn.close()
    
    print(f"\n=== Update Summary ===")
    print(f"Total scripts: {len(scripts)}")
    print(f"Matched scripts: {matched_count}")
    print(f"Updated records: {updated_count}")
    print(f"Scripts with URLs: {total_with_urls}")
    
    return updated_count

def main():
    # パスの設定
    base_path = "/Users/mitsuruono/sunsun_script_search/sunsun_script_database"
    
    # CSVファイルのパス
    csv1_path = os.path.join(base_path, "master/202508作業進捗 - 作業進捗_new.csv")
    csv2_path = os.path.join(base_path, "master/202508作業進捗 - 過去動画一覧2019.csv")
    
    # データベースのパス
    db_path = os.path.join(base_path, "sunsun_final_dialogue_database_proper.db")
    
    print("=== Loading URLs from CSV files ===")
    
    # 作業進捗_new.csv から読み込み（管理番号: 列3, 台本URL: 列10）
    print(f"\nReading: {csv1_path}")
    urls1 = load_csv_urls(csv1_path, id_column=3, url_column=10, skip_rows=2)
    print(f"Found {len(urls1)} URLs")
    
    # 過去動画一覧2019.csv から読み込み（管理番号: 列3, 台本URL: 列4）
    print(f"\nReading: {csv2_path}")
    urls2 = load_csv_urls(csv2_path, id_column=3, url_column=4, skip_rows=4)
    print(f"Found {len(urls2)} URLs")
    
    # URLマッピングを統合
    all_urls = {**urls1, **urls2}
    print(f"\nTotal unique management IDs with URLs: {len(all_urls)}")
    
    # データベースを更新
    if all_urls:
        print("\n=== Updating Database ===")
        update_database_with_urls(db_path, all_urls)
    else:
        print("\nNo URLs found to update")

if __name__ == "__main__":
    main()