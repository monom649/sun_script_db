const https = require('https');
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Dropbox直接ダウンロードURL
const DROPBOX_URL = 'https://www.dropbox.com/scl/fi/thzlrt9skagtyfbx8rm0h/sunsun_final_dialogue_database_with_urls.db?rlkey=3f2nhbuk0g1m4d62qn4lss71u&st=1igvqg04&dl=1';

let dbPath = null;

function downloadDatabase() {
  return new Promise((resolve, reject) => {
    if (dbPath && fs.existsSync(dbPath)) {
      const stats = fs.statSync(dbPath);
      if (stats.size > 1000000) {
        resolve(dbPath);
        return;
      }
    }

    dbPath = path.join(os.tmpdir(), `sunsun_database_${Date.now()}.db`);
    console.log('Downloading database to:', dbPath);
    
    const file = fs.createWriteStream(dbPath);
    
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };
    
    const request = https.get(DROPBOX_URL, options, (response) => {
      console.log('Response status:', response.statusCode);
      
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        console.log('Redirected to:', response.headers.location);
        
        const redirectUrl = response.headers.location.startsWith('http') 
          ? response.headers.location 
          : 'https:' + response.headers.location;
        
        const redirectRequest = https.get(redirectUrl, options, (redirectResponse) => {
          console.log('Redirect response status:', redirectResponse.statusCode);
          
          if (redirectResponse.statusCode >= 300 && redirectResponse.statusCode < 400 && redirectResponse.headers.location) {
            const finalUrl = redirectResponse.headers.location.startsWith('http') 
              ? redirectResponse.headers.location 
              : 'https:' + redirectResponse.headers.location;
            
            console.log('Final redirect to:', finalUrl);
            
            const finalRequest = https.get(finalUrl, options, (finalResponse) => {
              finalResponse.pipe(file);
              file.on('finish', () => {
                file.close();
                
                const stats = fs.statSync(dbPath);
                console.log('File size on disk:', stats.size);
                
                if (stats.size < 1000000) {
                  const errorMsg = `Downloaded file too small: ${stats.size} bytes`;
                  console.error(errorMsg);
                  reject(new Error(errorMsg));
                  return;
                }
                
                resolve(dbPath);
              });
            });
            
            finalRequest.on('error', reject);
          } else {
            redirectResponse.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve(dbPath);
            });
          }
        });
        
        redirectRequest.on('error', reject);
      } else {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(dbPath);
        });
      }
    });
    
    request.on('error', reject);
    file.on('error', reject);
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
      let scriptName = queryStringParameters.script_name || '';
      const keyword = queryStringParameters.keyword || '';
      
      // 文字列正規化とトリム処理
      const originalScriptName = scriptName;
      scriptName = scriptName.normalize('NFC').trim();
      
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

      console.log('Script detail request:', scriptName);

      // データベースをダウンロード
      const dbFile = await downloadDatabase();
      
      // データベース接続
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
      
      return new Promise((resolve, reject) => {
        db.get(scriptQuery, [scriptName], (err, scriptInfo) => {
          if (err) {
            console.error('Script info query error:', err);
            db.close();
            resolve({
              statusCode: 500,
              headers,
              body: JSON.stringify({
                success: false,
                error: 'データベースクエリエラー: ' + err.message
              })
            });
            return;
          }
          
          if (!scriptInfo) {
            // トリム済み名前で再試行
            const trimmedName = originalScriptName.trim();
            db.get(scriptQuery, [trimmedName], (retryErr, retryResult) => {
              db.close();
              
              if (retryResult) {
                console.log('Found with trimmed name:', trimmedName);
                processScript(retryResult, trimmedName, keyword, resolve, headers);
              } else {
                resolve({
                  statusCode: 404,
                  headers,
                  body: JSON.stringify({
                    success: false,
                    error: '台本が見つかりません',
                    debug: {
                      searched: scriptName,
                      original: originalScriptName,
                      trimmed: trimmedName
                    }
                  })
                });
              }
            });
            return;
          }
          
          // 成功: セリフ詳細を取得
          processScript(scriptInfo, scriptName, keyword, resolve, headers);
        });
      });
      
    } catch (error) {
      console.error('Error in script detail handler:', error);
      
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: error.message || 'サーバーエラーが発生しました'
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

function processScript(scriptInfo, scriptName, keyword, resolve, headers) {
  // 新しいDB接続でセリフを取得
  const dbFile = path.join(os.tmpdir(), `sunsun_database_${Date.now()}.db`);
  if (!fs.existsSync(dbFile)) {
    // dbPathを使用
    if (!dbPath || !fs.existsSync(dbPath)) {
      resolve({
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'データベースファイルが見つかりません'
        })
      });
      return;
    }
  }
  
  const db = new sqlite3.Database(dbPath);
  
  // セリフ詳細を取得
  let dialogueQuery;
  let params;
  
  if (keyword) {
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
      resolve({
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'セリフ取得エラー: ' + err.message
        })
      });
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
}