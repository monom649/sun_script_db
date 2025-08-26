const https = require('https');
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const os = require('os');
const url = require('url');

// Dropbox直接ダウンロードURL
const DROPBOX_URL = 'https://www.dropbox.com/scl/fi/dljhp6xzshdgvq7vqk3sz/sunsun_final_dialogue_database_proper.db?rlkey=qlf38ydm1b0n0ocsdbpjx0ih8&st=2h1nmfhq&dl=1';

let dbPath = null;

function downloadDatabase() {
  return new Promise((resolve, reject) => {
    if (dbPath && fs.existsSync(dbPath)) {
      // ファイルサイズをチェック
      const stats = fs.statSync(dbPath);
      if (stats.size > 1000000) { // 1MB以上なら有効とみなす
        resolve(dbPath);
        return;
      }
    }

    dbPath = path.join(os.tmpdir(), `sunsun_database_${Date.now()}.db`);
    console.log('Downloading database to:', dbPath);
    
    const file = fs.createWriteStream(dbPath);
    
    // User-Agentを追加してブラウザっぽくする
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    };
    
    const request = https.get(DROPBOX_URL, options, (response) => {
      console.log('Response status:', response.statusCode);
      
      // リダイレクトをフォロー（複数回対応）
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        console.log('Redirected to:', response.headers.location);
        
        const redirectUrl = response.headers.location.startsWith('http') 
          ? response.headers.location 
          : 'https:' + response.headers.location;
        
        const redirectRequest = https.get(redirectUrl, options, (redirectResponse) => {
          console.log('Redirect response status:', redirectResponse.statusCode);
          
          if (redirectResponse.statusCode >= 300 && redirectResponse.statusCode < 400 && redirectResponse.headers.location) {
            // 2回目のリダイレクト
            const finalUrl = redirectResponse.headers.location.startsWith('http') 
              ? redirectResponse.headers.location 
              : 'https:' + redirectResponse.headers.location;
            
            console.log('Final redirect to:', finalUrl);
            
            const finalRequest = https.get(finalUrl, options, (finalResponse) => {
              handleResponse(finalResponse, file, dbPath, resolve, reject);
            });
            
            finalRequest.on('error', reject);
          } else {
            handleResponse(redirectResponse, file, dbPath, resolve, reject);
          }
        });
        
        redirectRequest.on('error', reject);
      } else {
        handleResponse(response, file, dbPath, resolve, reject);
      }
    });
    
    request.on('error', reject);
    file.on('error', reject);
  });
}

function handleResponse(response, file, dbPath, resolve, reject) {
  let downloadedBytes = 0;
  
  response.on('data', (chunk) => {
    downloadedBytes += chunk.length;
  });
  
  response.pipe(file);
  
  file.on('finish', () => {
    file.close();
    
    console.log('Download finished, size:', downloadedBytes);
    
    // ファイルサイズをチェック
    const stats = fs.statSync(dbPath);
    console.log('File size on disk:', stats.size);
    
    if (stats.size < 1000000) { // 1MB未満は問題
      const errorMsg = `Downloaded file too small: ${stats.size} bytes`;
      console.error(errorMsg);
      reject(new Error(errorMsg));
      return;
    }
    
    // SQLite ファイルかチェック
    const buffer = fs.readFileSync(dbPath, { start: 0, end: 15 });
    const header = buffer.toString();
    
    if (!header.includes('SQLite format 3')) {
      const errorMsg = `Not a valid SQLite file. Header: ${header}`;
      console.error(errorMsg);
      reject(new Error(errorMsg));
      return;
    }
    
    console.log('Valid SQLite database downloaded');
    resolve(dbPath);
  });
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  // Handle OPTIONS request for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Handle GET request
  if (event.httpMethod === 'GET') {
    try {
      // URLパラメータを取得
      const queryStringParameters = event.queryStringParameters || {};
      const keyword = queryStringParameters.q || '';
      
      if (!keyword) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'キーワードが必要です'
          })
        };
      }

      // データベースをダウンロード
      const dbFile = await downloadDatabase();
      
      return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbFile);
        
        // キーワード検索クエリ
        const query = `
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
        `;
        
        const keywordParam = `%${keyword}%`;
        const params = [keywordParam, keywordParam, keywordParam, keywordParam, keywordParam];
        
        db.all(query, params, (err, rows) => {
          db.close();
          
          if (err) {
            reject(err);
            return;
          }
          
          // 台本ごとにグループ化
          const scriptsDict = {};
          
          rows.forEach(row => {
            const scriptName = row.script_name;
            
            if (!scriptsDict[scriptName]) {
              scriptsDict[scriptName] = {
                script_name: scriptName,
                script_url: row.script_url || '',
                release_date: row.release_date || '',
                youtube_title: row.youtube_title || '',
                youtube_url: row.youtube_url || '',
                dialogues: [],
                characters: new Set()
              };
            }
            
            // キーワードがセリフ内容に含まれる場合のみセリフを追加
            const dialogue = row.dialogue || '';
            if (dialogue.toLowerCase().includes(keyword.toLowerCase())) {
              scriptsDict[scriptName].dialogues.push({
                character: row.character || '',
                dialogue: dialogue,
                row_number: row.row_number || 0
              });
              
              if (row.character) {
                scriptsDict[scriptName].characters.add(row.character);
              }
            }
          });
          
          // 結果を整形
          const results = [];
          Object.values(scriptsDict).forEach(scriptData => {
            if (scriptData.dialogues.length > 0) {
              const actualMatchCount = scriptData.dialogues.length;
              scriptData.dialogues = scriptData.dialogues.slice(0, 3); // 最初の3件のみ
              scriptData.characters = Array.from(scriptData.characters).join(', ');
              scriptData.match_count = actualMatchCount;
              results.push(scriptData);
            }
          });
          
          // マッチ数とリリース日でソート
          results.sort((a, b) => {
            if (b.match_count !== a.match_count) {
              return b.match_count - a.match_count;
            }
            return (b.release_date || '').localeCompare(a.release_date || '');
          });
          
          const response = {
            success: true,
            keyword: keyword,
            total_results: results.length,
            data: results
          };
          
          resolve({
            statusCode: 200,
            headers,
            body: JSON.stringify(response)
          });
        });
      });
      
    } catch (error) {
      console.error('Error in search handler:', error);
      
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: error.message
        })
      };
    }
  }

  // Method not allowed
  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({ error: 'Method not allowed' })
  };
};