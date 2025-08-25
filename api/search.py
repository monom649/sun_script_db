import sqlite3
import urllib.request
import tempfile
import os
import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Dropbox直接ダウンロードURL
DROPBOX_URL = 'https://www.dropbox.com/scl/fi/nzwiyi3p3fnhsqzc3lbt1/sunsun_final_dialogue_database.db?rlkey=28qvhjdjcuzy817769n992q2o&st=n5ru9awz&dl=1'

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
            
            # キーワード検索クエリ
            query = '''
                SELECT DISTINCT 
                    script_name,
                    script_url,
                    GROUP_CONCAT(DISTINCT character) as characters,
                    release_date,
                    youtube_title,
                    youtube_url,
                    COUNT(*) as match_count
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
                GROUP BY script_name, release_date, youtube_title, youtube_url, script_url
                ORDER BY match_count DESC, release_date DESC
                LIMIT 50
            '''
            
            keyword_param = f'%{keyword}%'
            params = [keyword_param] * 5
            
            cursor.execute(query, params)
            results = []
            
            for row in cursor.fetchall():
                results.append({
                    'script_name': row['script_name'] or '',
                    'script_url': row['script_url'] or '',
                    'characters': row['characters'] or '',
                    'release_date': row['release_date'] or '',
                    'youtube_title': row['youtube_title'] or '',
                    'youtube_url': row['youtube_url'] or '',
                    'youtube_release_date': row['release_date'] or '',
                    'match_count': row['match_count'] or 0
                })
            
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