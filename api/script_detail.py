from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import sqlite3
import urllib.request
import tempfile
import os
import json
import ssl

# Dropbox直接ダウンロードURL
DROPBOX_URL = 'https://www.dropbox.com/scl/fi/dljhp6xzshdgvq7vqk3sz/sunsun_final_dialogue_database_proper.db?rlkey=qlf38ydm1b0n0ocsdbpjx0ih8&st=2h1nmfhq&dl=1'

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
        # SSL証明書検証をスキップ
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        
        opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl_context))
        urllib.request.install_opener(opener)
        
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
            # URLパラメータを取得
            parsed_url = urlparse(self.path)
            query_params = parse_qs(parsed_url.query)
            script_name = query_params.get('script_name', [''])[0].strip()
            keyword = query_params.get('keyword', [''])[0].strip()
            
            if not script_name:
                response = {
                    'success': False,
                    'error': '台本名が必要です'
                }
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(response).encode())
                return
            
            # データベース検索
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # 台本詳細情報を取得
            script_query = '''
                SELECT DISTINCT
                    script_name,
                    script_url,
                    release_date,
                    youtube_title,
                    youtube_url,
                    youtube_video_id,
                    themes,
                    subjects,
                    category
                FROM dialogues 
                WHERE script_name = ?
                LIMIT 1
            '''
            
            cursor.execute(script_query, (script_name,))
            script_info = cursor.fetchone()
            
            if not script_info:
                response = {
                    'success': False,
                    'error': '台本が見つかりません'
                }
                self.send_response(404)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(response).encode())
                conn.close()
                return
            
            # セリフ詳細を取得
            if keyword:
                # キーワード指定時は該当セリフのみ
                dialogue_query = '''
                    SELECT 
                        character,
                        dialogue,
                        row_number
                    FROM dialogues 
                    WHERE script_name = ?
                    AND dialogue LIKE ?
                    AND dialogue IS NOT NULL 
                    AND dialogue != ""
                    ORDER BY row_number
                '''
                cursor.execute(dialogue_query, (script_name, f'%{keyword}%'))
            else:
                # 全セリフ取得
                dialogue_query = '''
                    SELECT 
                        character,
                        dialogue,
                        row_number
                    FROM dialogues 
                    WHERE script_name = ?
                    AND dialogue IS NOT NULL 
                    AND dialogue != ""
                    ORDER BY row_number
                '''
                cursor.execute(dialogue_query, (script_name,))
            
            dialogues = []
            match_count = 0
            
            for row in cursor.fetchall():
                dialogue_text = row['dialogue'] or ''
                is_match = False
                
                if keyword and keyword.lower() in dialogue_text.lower():
                    is_match = True
                    match_count += 1
                
                dialogues.append({
                    'character': row['character'] or '',
                    'dialogue': dialogue_text,
                    'row_number': row['row_number'] or 0,
                    'is_match': is_match
                })
            
            # マッチ度計算（キーワード指定時のみ）
            match_confidence = 0
            if keyword and dialogues:
                match_confidence = match_count / len(dialogues)
            
            conn.close()
            
            response = {
                'success': True,
                'data': {
                    'script_name': script_info['script_name'],
                    'script_url': script_info['script_url'] or '',
                    'release_date': script_info['release_date'] or '',
                    'youtube_title': script_info['youtube_title'] or '',
                    'youtube_url': script_info['youtube_url'] or '',
                    'youtube_video_id': script_info['youtube_video_id'] or '',
                    'themes': script_info['themes'] or '',
                    'subjects': script_info['subjects'] or '',
                    'category': script_info['category'] or '',
                    'total_dialogues': len(dialogues),
                    'match_count': match_count,
                    'match_confidence': match_confidence,
                    'keyword': keyword,
                    'dialogues': dialogues
                }
            }
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.end_headers()
            
            self.wfile.write(json.dumps(response).encode())
            
        except Exception as e:
            print(f"Error in script detail handler: {e}")
            response = {
                'success': False,
                'error': str(e)
            }
            
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            self.wfile.write(json.dumps(response).encode())
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()