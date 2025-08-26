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

function processScriptInfo(db, scriptInfo, scriptName, keyword, resolve, reject, headers) {
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
      
      // 元のスクリプト名を保存
      const originalScriptName = scriptName;
      
      // 文字列正規化とトリム処理
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

      console.log('Script detail request:');
      console.log('  Original:', originalScriptName);
      console.log('  Processed:', scriptName);
      console.log('  Original length:', originalScriptName.length);
      console.log('  Processed length:', scriptName.length);
      console.log('  Original hex:', Buffer.from(originalScriptName, 'utf8').toString('hex'));
      console.log('  Processed hex:', Buffer.from(scriptName, 'utf8').toString('hex'));

      // データベースをダウンロード
      const dbFile = await downloadDatabase();
      
      return await new Promise((resolve, reject) => {
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
        
        // 複数の検索戦略を試行
        const searchStrategies = [
          scriptName,                    // 処理済み名前
          originalScriptName,            // 元の名前
          scriptName.trim(),             // トリム済み
          originalScriptName.trim(),     // 元のトリム済み
          scriptName.normalize('NFC'),   // 正規化済み
          originalScriptName.normalize('NFC')  // 元の正規化済み
        ];
        
        let currentStrategyIndex = 0;
        
        function tryNextStrategy() {
          if (currentStrategyIndex >= searchStrategies.length) {
            // すべての戦略が失敗した場合、あいまい検索
            console.log('All exact search strategies failed. Trying fuzzy search...');
            
            const fuzzyQuery = "SELECT DISTINCT script_name FROM dialogues WHERE script_name LIKE ? LIMIT 5";
            const fuzzySearchTerm = `%${scriptName.substring(0, 10)}%`;
            
            db.all(fuzzyQuery, [fuzzySearchTerm], (fuzzyErr, fuzzyResults) => {
              if (fuzzyResults && fuzzyResults.length > 0) {
                console.log('Found via fuzzy search:', fuzzyResults.map(r => r.script_name));
                
                // 最初の結果で再試行
                const bestMatch = fuzzyResults[0];
                db.get(scriptQuery, [bestMatch.script_name], (retryErr, retryResult) => {
                  if (retryResult) {
                    console.log('Success with fuzzy match:', bestMatch.script_name);
                    processScriptInfo(db, retryResult, bestMatch.script_name, keyword, resolve, reject, headers);
                  } else {
                    db.close();
                    resolve({
                      statusCode: 404,
                      headers,
                      body: JSON.stringify({
                        success: false,
                        error: '台本が見つかりません（あいまい検索でも失敗）',
                        debug: {
                          original: originalScriptName,
                          processed: scriptName,
                          strategies_tried: searchStrategies,
                          fuzzy_results: fuzzyResults.map(r => r.script_name)
                        }
                      })
                    });
                  }
                });
              } else {
                db.close();
                resolve({
                  statusCode: 404,
                  headers,
                  body: JSON.stringify({
                    success: false,
                    error: '台本が見つかりません',
                    debug: {
                      original: originalScriptName,
                      processed: scriptName,
                      strategies_tried: searchStrategies
                    }
                  })
                });
              }
            });
            return;
          }
          
          const currentStrategy = searchStrategies[currentStrategyIndex];
          console.log(`Trying strategy ${currentStrategyIndex + 1}: "${currentStrategy}"`);
          
          db.get(scriptQuery, [currentStrategy], (err, scriptInfo) => {
            if (err) {
              console.error('Script info query error:', err);
              db.close();
              reject(err);
              return;
            }
            
            if (scriptInfo) {
              console.log(`Success with strategy ${currentStrategyIndex + 1}: "${currentStrategy}"`);
              processScriptInfo(db, scriptInfo, currentStrategy, keyword, resolve, reject, headers);
            } else {
              currentStrategyIndex++;
              tryNextStrategy();
            }
          });
        }
        
        tryNextStrategy();
      
    } catch (error) {
      console.error('Error in script detail handler:', error);
      
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: error ? error.message || 'サーバーエラーが発生しました' : '不明なエラーが発生しました',
          debug: {
            error_type: typeof error,
            error_string: String(error),
            stack: error ? error.stack : null
          }
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