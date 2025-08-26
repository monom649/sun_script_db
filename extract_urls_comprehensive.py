#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import sqlite3
import re
import sys
import os

def extract_management_id_from_name(script_name):
    """台本名から管理番号を抽出（より広範囲に対応）"""
    # B1234, A01, E01, F002, H001, PK-002等に対応
    patterns = [
        r'^([ABEFHP]K?[-_]?\d+)',  # 英字+数字パターン
        r'^([A-Z]+\d+)',          # 英字+数字パターン（より広範囲）
    ]
    
    for pattern in patterns:
        match = re.match(pattern, script_name)
        if match:
            return match.group(1)
    return None

def load_all_csvs(base_path):
    """全CSVファイルから管理番号とURLのマッピングを読み込む"""
    csv_files = [
        "202508作業進捗 - 作業進捗_new.csv",
        "202508作業進捗 - 過去動画一覧2019.csv"
    ]
    
    all_urls = {}
    
    for csv_file in csv_files:
        csv_path = os.path.join(base_path, "master", csv_file)
        print(f"\nReading: {csv_path}")
        
        if not os.path.exists(csv_path):
            print(f"File not found: {csv_path}")
            continue
            
        try:
            with open(csv_path, 'r', encoding='utf-8') as f:
                reader = csv.reader(f)
                row_count = 0
                found_count = 0
                
                for row in reader:
                    row_count += 1
                    
                    # 最初の数行をスキップ
                    if row_count <= 4:
                        continue
                    
                    # 全ての列をチェックして管理番号とURLを探す
                    management_id = None
                    script_url = None
                    
                    # 各列をチェック
                    for i, cell in enumerate(row):
                        cell = cell.strip() if cell else ""
                        
                        # 管理番号の可能性がある列をチェック
                        if not management_id and cell:
                            extracted_id = extract_management_id_from_name(cell)
                            if extracted_id:
                                management_id = extracted_id
                        
                        # GoogleドキュメントURLをチェック
                        if not script_url and cell and 'docs.google.com' in cell:
                            script_url = cell
                    
                    # 両方見つかった場合に追加
                    if management_id and script_url:
                        all_urls[management_id] = script_url
                        found_count += 1
                        print(f"Found: {management_id} -> {script_url[:60]}...")
                
                print(f"Processed {row_count} rows, found {found_count} URLs")
                
        except Exception as e:
            print(f"Error reading {csv_path}: {e}")
    
    return all_urls

def update_database_comprehensive(db_path, url_mapping):
    """データベースを包括的に更新"""
    if not os.path.exists(db_path):
        print(f"Database not found: {db_path}")
        return 0
        
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # まず現在のデータを確認
    cursor.execute("SELECT DISTINCT script_name FROM dialogues")
    scripts = cursor.fetchall()
    
    updated_count = 0
    matched_count = 0
    matched_scripts = []
    
    for (script_name,) in scripts:
        management_id = extract_management_id_from_name(script_name)
        
        if management_id and management_id in url_mapping:
            script_url = url_mapping[management_id]
            matched_count += 1
            matched_scripts.append((management_id, script_name, script_url))
            
            # script_urlを更新
            cursor.execute("""
                UPDATE dialogues 
                SET script_url = ? 
                WHERE script_name = ?
            """, (script_url, script_name))
            
            updated_count += cursor.rowcount
            print(f"Updated {script_name}: {script_url[:60]}...")
    
    conn.commit()
    
    # 更新結果を確認
    cursor.execute("SELECT COUNT(DISTINCT script_name) FROM dialogues WHERE script_url IS NOT NULL AND script_url != ''")
    total_with_urls = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(DISTINCT script_name) FROM dialogues")
    total_scripts = cursor.fetchone()[0]
    
    conn.close()
    
    print(f"\n=== Comprehensive Update Summary ===")
    print(f"Total scripts in DB: {total_scripts}")
    print(f"URLs found in CSVs: {len(url_mapping)}")
    print(f"Matched scripts: {matched_count}")
    print(f"Updated records: {updated_count}")
    print(f"Scripts with URLs: {total_with_urls}")
    print(f"Scripts still without URLs: {total_scripts - total_with_urls}")
    
    return updated_count

def main():
    # パスの設定
    base_path = "/Users/mitsuruono/sunsun_script_search/sunsun_script_database"
    
    # データベースのパス
    db_path = os.path.join(base_path, "sun_script_db/sunsun_final_dialogue_database_with_urls.db")
    
    print("=== Comprehensive URL Loading from CSV files ===")
    
    # 全CSVファイルから読み込み
    all_urls = load_all_csvs(base_path)
    
    print(f"\nTotal unique management IDs with URLs: {len(all_urls)}")
    
    # サンプルを表示
    if all_urls:
        print(f"\n=== Sample URLs Found ===")
        for i, (mgmt_id, url) in enumerate(list(all_urls.items())[:10]):
            print(f"{i+1}. {mgmt_id}: {url[:80]}...")
    
    # データベースを更新
    if all_urls:
        print(f"\n=== Updating Database Comprehensively ===")
        update_database_comprehensive(db_path, all_urls)
    else:
        print(f"\nNo URLs found to update")

if __name__ == "__main__":
    main()