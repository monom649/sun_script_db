const https = require('https');
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
      const scriptName = queryStringParameters.script_name || '';
      const keyword = queryStringParameters.keyword || '';
      
      if (!scriptName) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: '台本名が必要です'
          })
        };
      }

      console.log('Script detail request for:', scriptName);
      console.log('Script name length:', scriptName.length);
      console.log('Script name hex:', Buffer.from(scriptName, 'utf8').toString('hex'));

      // データベースをダウンロード
      const dbFile = await downloadDatabase();
      
      return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbFile);
        
        // 台本詳細情報を取得
        const scriptQuery = `
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
        `;
        
        db.get(scriptQuery, [scriptName], (err, scriptInfo) => {
          if (err) {
            console.error('Script info query error:', err);
            db.close();
            reject(err);
            return;
          }
          
          if (!scriptInfo) {
            console.log('Script not found. Checking similar names...');
            
            // デバッグ: 似た名前を検索
            const debugQuery = "SELECT DISTINCT script_name FROM dialogues WHERE script_name LIKE '%B2231%' LIMIT 5";
            db.all(debugQuery, (debugErr, debugRows) => {
              console.log('Similar script names found:', debugRows);
              
              db.close();
              resolve({
                statusCode: 404,
                headers,
                body: JSON.stringify({
                  success: false,
                  error: '台本が見つかりません',
                  debug: {
                    searched_for: scriptName,
                    searched_length: scriptName.length,
                    similar_names: debugRows || []
                  }
                })
              });
            });
            return;
          }
          
          // セリフ詳細を取得
          let dialogueQuery;
          let params;
          
          if (keyword) {
            // キーワード指定時は該当セリフのみ
            dialogueQuery = `
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
            `;
            params = [scriptName, `%${keyword}%`];
          } else {
            // 全セリフ取得
            dialogueQuery = `
              SELECT 
                character,
                dialogue,
                row_number
              FROM dialogues 
              WHERE script_name = ?
              AND dialogue IS NOT NULL 
              AND dialogue != ""
              ORDER BY row_number
            `;
            params = [scriptName];
          }
          
          db.all(dialogueQuery, params, (err, rows) => {
            db.close();
            
            if (err) {
              console.error('Dialogue query error:', err);
              reject(err);
              return;
            }
            
            const dialogues = [];
            let matchCount = 0;
            
            rows.forEach(row => {
              const dialogueText = row.dialogue || '';
              let isMatch = false;
              
              if (keyword && dialogueText.toLowerCase().includes(keyword.toLowerCase())) {
                isMatch = true;
                matchCount++;
              }
              
              dialogues.push({
                character: row.character || '',
                dialogue: dialogueText,
                row_number: row.row_number || 0,
                is_match: isMatch
              });
            });
            
            // マッチ度計算（キーワード指定時のみ）
            const matchConfidence = keyword && dialogues.length > 0 
              ? matchCount / dialogues.length 
              : 0;
            
            const response = {
              success: true,
              data: {
                script_name: scriptInfo.script_name,
                script_url: scriptInfo.script_url || '',
                release_date: scriptInfo.release_date || '',
                youtube_title: scriptInfo.youtube_title || '',
                youtube_url: scriptInfo.youtube_url || '',
                youtube_video_id: scriptInfo.youtube_video_id || '',
                themes: scriptInfo.themes || '',
                subjects: scriptInfo.subjects || '',
                category: scriptInfo.category || '',
                total_dialogues: dialogues.length,
                match_count: matchCount,
                match_confidence: matchConfidence,
                keyword: keyword,
                dialogues: dialogues
              }
            };
            
            resolve({
              statusCode: 200,
              headers,
              body: JSON.stringify(response)
            });
          });
        });
      });
      
    } catch (error) {
      console.error('Error in script detail handler:', error);
      
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