import sqlite3
import urllib.request
import tempfile
import os
import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Dropbox直接ダウンロードURL
DROPBOX_URL = 'https://www.dropbox.com/scl/fi/eiiw2sav60woxr2ndrhqz/sunsun_final_dialogue_database_proper.db?rlkey=jnymntxo6ns7xdjv5fs21xok2&st=0tj8igi4&dl=1'

# データベース一時ファイル
db_path = None

def download_database():
    """Dropboxからデータベースファイルをダウンロード"""
    global db_path
    
    if db_path and os.path.exists(db_path):
        return db_path
    
    try:
        # 一時ファイルを作成
        temp_fd, db_path = tempfile.mkstemp(suffix='.db')
        os.close(temp_fd)
        
        print(f"Downloading database from {DROPBOX_URL}")
        urllib.request.urlretrieve(DROPBOX_URL, db_path)
        print(f"Database downloaded to {db_path}")
        
        return db_path
        
    except Exception as e:
        print(f"Error downloading database: {e}")
        raise

def get_db_connection():
    """データベース接続を取得"""
    db_file = download_database()
    conn = sqlite3.connect(db_file)
    conn.row_factory = sqlite3.Row
    return conn

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            # CORSヘッダーを設定
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            
            # URLを解析
            url_parts = urlparse(self.path)
            query_params = parse_qs(url_parts.query)
            
            # キーワードを取得
            keyword = query_params.get('q', [''])[0].strip()
            
            if not keyword:
                response = {
                    'success': False,
                    'error': 'キーワードが必要です'
                }
                self.wfile.write(json.dumps(response).encode())
                return
            
            # データベース検索
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # キーワード検索クエリ（セリフ詳細付き）
            query = '''
                SELECT 
                    script_name,
                    script_url,
                    character,
                    dialogue,
                    row_number,
                    release_date,
                    youtube_title,
                    youtube_url
                FROM dialogues 
                WHERE (
                    dialogue LIKE ? OR 
                    script_name LIKE ? OR 
                    youtube_title LIKE ? OR 
                    themes LIKE ? OR 
                    subjects LIKE ?
                )
                AND dialogue IS NOT NULL 
                AND dialogue != ""
                ORDER BY script_name, row_number
            '''
            
            keyword_param = f'%{keyword}%'
            params = [keyword_param] * 5
            
            cursor.execute(query, params)
            
            # 台本ごとにグループ化
            scripts_dict = {}
            for row in cursor.fetchall():
                script_name = row['script_name']
                if script_name not in scripts_dict:
                    scripts_dict[script_name] = {
                        'script_name': script_name,
                        'script_url': row['script_url'] or '',
                        'release_date': row['release_date'] or '',
                        'youtube_title': row['youtube_title'] or '',
                        'youtube_url': row['youtube_url'] or '',
                        'dialogues': [],
                        'characters': set()
                    }
                
                # キーワードがセリフ内容に含まれる場合のみセリフを追加
                dialogue = row['dialogue'] or ''
                if keyword.lower() in dialogue.lower():
                    scripts_dict[script_name]['dialogues'].append({
                        'character': row['character'] or '',
                        'dialogue': dialogue,
                        'row_number': row['row_number'] or 0
                    })
                    if row['character']:
                        scripts_dict[script_name]['characters'].add(row['character'])
            
            # 結果を整形
            results = []
            for script_data in scripts_dict.values():
                if script_data['dialogues']:  # セリフがある場合のみ
                    # 実際のマッチ数を記録
                    actual_match_count = len(script_data['dialogues'])
                    # 代表的なセリフのみ表示（最初の3件）
                    script_data['dialogues'] = script_data['dialogues'][:3]
                    script_data['characters'] = ', '.join(list(script_data['characters']))
                    script_data['match_count'] = actual_match_count
                    results.append(script_data)
            
            # マッチ数とリリース日でソート
            results.sort(key=lambda x: (x['match_count'], x['release_date']), reverse=True)
            
            conn.close()
            
            response = {
                'success': True,
                'keyword': keyword,
                'total_results': len(results),
                'data': results
            }
            
            self.wfile.write(json.dumps(response).encode())
            
        except Exception as e:
            print(f"Error in search handler: {e}")
            self.send_response(500)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            
            response = {
                'success': False,
                'error': str(e)
            }
            self.wfile.write(json.dumps(response).encode())
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()