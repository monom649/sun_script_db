#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from flask import Flask, jsonify, request
from flask_cors import CORS
import sqlite3
import json
import re
from datetime import datetime

app = Flask(__name__)
CORS(app)

# データベースパス
DB_PATH = '/Users/mitsuruono/sunsun_script_search/sunsun_script_database/sunsun_final_dialogue_database.db'

def get_db_connection():
    """データベース接続"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/api/stats')
def get_stats():
    """データベース統計情報を取得"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # 基本統計
        cursor.execute('SELECT COUNT(DISTINCT script_name) as total_scripts FROM dialogues')
        total_scripts = cursor.fetchone()['total_scripts']
        
        cursor.execute('SELECT COUNT(*) as total_dialogues FROM dialogues')
        total_dialogues = cursor.fetchone()['total_dialogues']
        
        cursor.execute('''
            SELECT COUNT(DISTINCT script_name) as youtube_connected 
            FROM dialogues 
            WHERE youtube_url IS NOT NULL AND youtube_url != ""
        ''')
        youtube_connected = cursor.fetchone()['youtube_connected']
        
        # キャラクター別統計
        cursor.execute('''
            SELECT character, COUNT(*) as count 
            FROM dialogues 
            WHERE character IS NOT NULL AND character != ""
            GROUP BY character 
            ORDER BY count DESC 
            LIMIT 10
        ''')
        character_stats = [dict(row) for row in cursor.fetchall()]
        
        # 信頼度別統計
        cursor.execute('''
            SELECT 
                COUNT(DISTINCT CASE WHEN match_confidence >= 0.8 THEN script_name END) as high_confidence,
                COUNT(DISTINCT CASE WHEN match_confidence >= 0.5 AND match_confidence < 0.8 THEN script_name END) as medium_confidence,
                COUNT(DISTINCT CASE WHEN match_confidence < 0.5 THEN script_name END) as low_confidence
            FROM dialogues
        ''')
        confidence_stats = dict(cursor.fetchone())
        
        # 年代別統計
        cursor.execute('''
            SELECT 
                substr(release_date, 1, 4) as year,
                COUNT(DISTINCT script_name) as count
            FROM dialogues 
            WHERE release_date IS NOT NULL AND release_date != ""
            GROUP BY substr(release_date, 1, 4)
            ORDER BY year
        ''')
        year_stats = [dict(row) for row in cursor.fetchall()]
        
        conn.close()
        
        return jsonify({
            'success': True,
            'data': {
                'total_scripts': total_scripts,
                'total_dialogues': total_dialogues,
                'youtube_connected': youtube_connected,
                'youtube_coverage': round((youtube_connected / total_scripts) * 100, 2),
                'character_stats': character_stats,
                'confidence_stats': confidence_stats,
                'year_stats': year_stats
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/search/scripts')
def search_scripts():
    """台本検索"""
    try:
        query = request.args.get('q', '').strip()
        theme = request.args.get('theme', '').strip()
        year = request.args.get('year', '').strip()
        limit = int(request.args.get('limit', 50))
        offset = int(request.args.get('offset', 0))
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # クエリ構築
        conditions = []
        params = []
        
        if query:
            conditions.append('''
                (script_name LIKE ? OR youtube_title LIKE ? OR themes LIKE ? OR subjects LIKE ?)
            ''')
            query_param = f'%{query}%'
            params.extend([query_param, query_param, query_param, query_param])
        
        if theme:
            conditions.append('themes LIKE ?')
            params.append(f'%{theme}%')
        
        if year:
            conditions.append('release_date LIKE ?')
            params.append(f'{year}%')
        
        where_clause = ' AND '.join(conditions) if conditions else '1=1'
        
        # メインクエリ
        sql_query = f'''
            SELECT DISTINCT 
                script_name,
                themes,
                subjects,
                release_date,
                youtube_title,
                youtube_url,
                match_confidence,
                COUNT(dialogue) as dialogue_count
            FROM dialogues 
            WHERE {where_clause}
            GROUP BY script_name, themes, subjects, release_date, youtube_title, youtube_url, match_confidence
            ORDER BY match_confidence DESC, release_date DESC
            LIMIT ? OFFSET ?
        '''
        
        params.extend([limit, offset])
        cursor.execute(sql_query, params)
        results = [dict(row) for row in cursor.fetchall()]
        
        # 総件数取得
        count_query = f'''
            SELECT COUNT(DISTINCT script_name) as total
            FROM dialogues 
            WHERE {where_clause}
        '''
        cursor.execute(count_query, params[:-2])  # limit, offsetを除く
        total_count = cursor.fetchone()['total']
        
        conn.close()
        
        return jsonify({
            'success': True,
            'data': {
                'results': results,
                'total_count': total_count,
                'has_more': (offset + limit) < total_count
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/search/keyword')
def search_by_keyword():
    """キーワード検索 - 台本URL/キャラクター名/台本日付/YouTubeタイトル,URL,配信日をリスト出力"""
    try:
        keyword = request.args.get('q', '').strip()
        
        if not keyword:
            return jsonify({
                'success': False,
                'error': 'キーワードが必要です'
            }), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # キーワードをダイアログ内容からも検索
        search_query = '''
            SELECT DISTINCT 
                script_name,
                character,
                release_date,
                youtube_title,
                youtube_url,
                script_url,
                GROUP_CONCAT(DISTINCT character) as all_characters,
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
        '''
        
        keyword_param = f'%{keyword}%'
        params = [keyword_param] * 5
        
        cursor.execute(search_query, params)
        results = cursor.fetchall()
        
        # 結果を指定フォーマットで整形
        formatted_results = []
        for row in results:
            formatted_results.append({
                'script_name': row['script_name'],
                'script_url': row['script_url'] or '',
                'characters': row['all_characters'] or '',
                'release_date': row['release_date'] or '',
                'youtube_title': row['youtube_title'] or '',
                'youtube_url': row['youtube_url'] or '',
                'youtube_release_date': row['release_date'] or '',  # 同じ日付を使用
                'match_count': row['match_count']
            })
        
        conn.close()
        
        return jsonify({
            'success': True,
            'keyword': keyword,
            'total_results': len(formatted_results),
            'data': formatted_results
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/search/dialogues')
def search_dialogues():
    """セリフ検索"""
    try:
        query = request.args.get('q', '').strip()
        character = request.args.get('character', '').strip()
        limit = int(request.args.get('limit', 50))
        offset = int(request.args.get('offset', 0))
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # クエリ構築
        conditions = []
        params = []
        
        if query:
            conditions.append('dialogue LIKE ?')
            params.append(f'%{query}%')
        
        if character:
            conditions.append('character = ?')
            params.append(character)
        
        where_clause = ' AND '.join(conditions) if conditions else '1=1'
        
        # メインクエリ
        sql_query = f'''
            SELECT 
                script_name,
                character,
                dialogue,
                row_number,
                themes,
                subjects,
                release_date,
                youtube_title,
                youtube_url,
                match_confidence
            FROM dialogues 
            WHERE {where_clause}
            AND dialogue IS NOT NULL 
            AND dialogue != ""
            ORDER BY match_confidence DESC, release_date DESC, row_number
            LIMIT ? OFFSET ?
        '''
        
        params.extend([limit, offset])
        cursor.execute(sql_query, params)
        results = [dict(row) for row in cursor.fetchall()]
        
        # 総件数取得
        count_query = f'''
            SELECT COUNT(*) as total
            FROM dialogues 
            WHERE {where_clause}
            AND dialogue IS NOT NULL 
            AND dialogue != ""
        '''
        cursor.execute(count_query, params[:-2])  # limit, offsetを除く
        total_count = cursor.fetchone()['total']
        
        conn.close()
        
        return jsonify({
            'success': True,
            'data': {
                'results': results,
                'total_count': total_count,
                'has_more': (offset + limit) < total_count
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/characters')
def get_characters():
    """キャラクター一覧とセリフ数を取得"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT 
                character,
                COUNT(*) as dialogue_count,
                COUNT(DISTINCT script_name) as script_count
            FROM dialogues 
            WHERE character IS NOT NULL AND character != ""
            GROUP BY character 
            ORDER BY dialogue_count DESC
        ''')
        
        results = [dict(row) for row in cursor.fetchall()]
        conn.close()
        
        return jsonify({
            'success': True,
            'data': results
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/themes')
def get_themes():
    """テーマ一覧を取得"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT DISTINCT themes
            FROM dialogues 
            WHERE themes IS NOT NULL AND themes != ""
        ''')
        
        all_themes = [row['themes'] for row in cursor.fetchall()]
        
        # テーマを分割して集計
        theme_count = {}
        for themes in all_themes:
            if themes:
                for theme in themes.split(','):
                    theme = theme.strip()
                    if theme:
                        theme_count[theme] = theme_count.get(theme, 0) + 1
        
        # 件数順にソート
        sorted_themes = sorted(theme_count.items(), key=lambda x: x[1], reverse=True)
        
        conn.close()
        
        return jsonify({
            'success': True,
            'data': [{'theme': theme, 'count': count} for theme, count in sorted_themes]
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/script/<script_name>')
def get_script_details(script_name):
    """個別台本の詳細情報を取得"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # 台本情報
        cursor.execute('''
            SELECT DISTINCT
                script_name,
                themes,
                subjects,
                story_structure,
                release_date,
                youtube_title,
                youtube_url,
                youtube_video_id,
                match_confidence
            FROM dialogues 
            WHERE script_name = ?
        ''', [script_name])
        
        script_info = cursor.fetchone()
        if not script_info:
            return jsonify({
                'success': False,
                'error': 'Script not found'
            }), 404
        
        # セリフ一覧
        cursor.execute('''
            SELECT 
                character,
                dialogue,
                row_number
            FROM dialogues 
            WHERE script_name = ?
            ORDER BY row_number
        ''', [script_name])
        
        dialogues = [dict(row) for row in cursor.fetchall()]
        
        # キャラクター統計
        cursor.execute('''
            SELECT 
                character,
                COUNT(*) as count
            FROM dialogues 
            WHERE script_name = ?
            AND character IS NOT NULL 
            AND character != ""
            GROUP BY character
            ORDER BY count DESC
        ''', [script_name])
        
        character_stats = [dict(row) for row in cursor.fetchall()]
        
        conn.close()
        
        return jsonify({
            'success': True,
            'data': {
                'script_info': dict(script_info),
                'dialogues': dialogues,
                'character_stats': character_stats
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({
        'success': False,
        'error': 'API endpoint not found'
    }), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({
        'success': False,
        'error': 'Internal server error'
    }), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)