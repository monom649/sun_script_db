#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import sqlite3
import re
import sys
import os

def extract_script_id_from_name(script_name):
    """台本名から管理番号を抽出"""
    match = re.match(r'^(B\d+)', script_name)
    if match:
        return match.group(1)
    return None

def load_csv_urls_new(csv_file_path):
    """作業進捗_new.csvから管理番号とURLのマッピングを読み込む"""
    url_mapping = {}
    
    try:
        with open(csv_file_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            row_count = 0
            
            for row in reader:
                row_count += 1
                # ヘッダー行をスキップ
                if row_count <= 4:
                    continue
                
                try:
                    # 管理番号は列3 (index 3)、台本URLは列11 (index 11)
                    if len(row) > 11:
                        management_id = row[3].strip() if row[3] else ""
                        script_url = row[11].strip() if row[11] else ""
                        
                        # 管理番号とURLが有効な場合のみ追加
                        if management_id and script_url and management_id.startswith('B'):
                            if 'docs.google.com' in script_url:
                                url_mapping[management_id] = script_url
                                print(f"Found in new.csv: {management_id} -> {script_url[:60]}...")
                except IndexError:
                    continue
                except Exception as e:
                    print(f"Error processing row {row_count}: {e}")
                    continue
                    
    except FileNotFoundError:
        print(f"File not found: {csv_file_path}")
    except Exception as e:
        print(f"Error reading CSV file: {e}")
    
    return url_mapping

def load_csv_urls_2019(csv_file_path):
    """過去動画一覧2019.csvから管理番号とURLのマッピングを読み込む"""
    url_mapping = {}
    
    try:
        with open(csv_file_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            row_count = 0
            
            for row in reader:
                row_count += 1
                # ヘッダー行をスキップ
                if row_count <= 4:
                    continue
                
                try:
                    # 管理番号は列3 (index 3)、台本URLは列4 (index 4) 
                    if len(row) > 4:
                        management_id = row[3].strip() if row[3] else ""
                        script_url = row[4].strip() if row[4] else ""
                        
                        # 管理番号とURLが有効な場合のみ追加
                        if management_id and script_url and management_id.startswith('B'):
                            if 'docs.google.com' in script_url:
                                url_mapping[management_id] = script_url
                                print(f"Found in 2019.csv: {management_id} -> {script_url[:60]}...")
                except IndexError:
                    continue
                except Exception as e:
                    print(f"Error processing row {row_count}: {e}")
                    continue
                    
    except FileNotFoundError:
        print(f"File not found: {csv_file_path}")
    except Exception as e:
        print(f"Error reading CSV file: {e}")
    
    return url_mapping

def update_database_with_urls(db_path, url_mapping):
    """データベースのscript_urlフィールドを更新"""
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
        management_id = extract_script_id_from_name(script_name)
        
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
    
    conn.close()
    
    print(f"\n=== Update Summary ===")
    print(f"Total scripts in DB: {len(scripts)}")
    print(f"URLs found in CSVs: {len(url_mapping)}")
    print(f"Matched scripts: {matched_count}")
    print(f"Updated records: {updated_count}")
    print(f"Scripts with URLs: {total_with_urls}")
    
    if matched_scripts:
        print(f"\n=== Sample Matched Scripts ===")
        for i, (mgmt_id, name, url) in enumerate(matched_scripts[:5]):
            print(f"{i+1}. {mgmt_id}: {name}")
            print(f"   URL: {url[:80]}...")
    
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
    
    # 作業進捗_new.csv から読み込み
    print(f"\nReading: {csv1_path}")
    urls1 = load_csv_urls_new(csv1_path)
    print(f"Found {len(urls1)} URLs in new.csv")
    
    # 過去動画一覧2019.csv から読み込み
    print(f"\nReading: {csv2_path}")
    urls2 = load_csv_urls_2019(csv2_path)
    print(f"Found {len(urls2)} URLs in 2019.csv")
    
    # URLマッピングを統合（新しいCSVを優先）
    all_urls = {**urls2, **urls1}  # urls1が後なので優先される
    print(f"\nTotal unique management IDs with URLs: {len(all_urls)}")
    
    # サンプルを表示
    if all_urls:
        print("\n=== Sample URLs Found ===")
        for i, (mgmt_id, url) in enumerate(list(all_urls.items())[:5]):
            print(f"{i+1}. {mgmt_id}: {url[:80]}...")
    
    # データベースを更新
    if all_urls:
        print("\n=== Updating Database ===")
        update_database_with_urls(db_path, all_urls)
    else:
        print("\nNo URLs found to update")

if __name__ == "__main__":
    main()