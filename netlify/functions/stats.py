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
            # データベース統計を取得
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # 基本統計
            cursor.execute('SELECT COUNT(DISTINCT script_name) as total_scripts FROM dialogues')
            total_scripts = cursor.fetchone()['total_scripts']
            
            cursor.execute('SELECT COUNT(*) as total_dialogues FROM dialogues')
            total_dialogues = cursor.fetchone()['total_dialogues']
            
            conn.close()
            
            response = {
                'success': True,
                'data': {
                    'total_scripts': total_scripts,
                    'total_dialogues': total_dialogues,
                    'status': 'Database loaded successfully'
                }
            }
            
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps(response)
            }
            
        except Exception as e:
            print(f"Error in stats handler: {e}")
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