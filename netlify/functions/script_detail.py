import json
import sqlite3
import urllib.request
import tempfile
import os
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
        
        # SSL証明書検証をスキップ
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        
        opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ssl_context))
        urllib.request.install_opener(opener)
        
        urllib.request.urlretrieve(DROPBOX_URL, db_path)
        
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

def main(event, context):
    """Netlify Function handler"""
    
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    }
    
    # Handle OPTIONS request for CORS
    if event['httpMethod'] == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': headers,
            'body': ''
        }
    
    # Handle GET request
    if event['httpMethod'] == 'GET':
        try:
            # URLパラメータを取得
            query_params = event.get('queryStringParameters', {}) or {}
            script_name = query_params.get('script_name', '').strip()
            keyword = query_params.get('keyword', '').strip()
            
            if not script_name:
                response = {
                    'success': False,
                    'error': '台本名が必要です'
                }
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps(response)
                }
            
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
                return {
                    'statusCode': 404,
                    'headers': headers,
                    'body': json.dumps(response)
                }
            
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
            
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps(response)
            }
            
        except Exception as e:
            print(f"Error in script detail handler: {e}")
            response = {
                'success': False,
                'error': str(e)
            }
            
            return {
                'statusCode': 500,
                'headers': headers,
                'body': json.dumps(response)
            }
    
    # Method not allowed
    return {
        'statusCode': 405,
        'headers': headers,
        'body': json.dumps({'error': 'Method not allowed'})
    }