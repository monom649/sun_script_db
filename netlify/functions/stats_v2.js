const https = require('https');
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 修正されたDropbox URL（dl=1を確実に）
const DROPBOX_URL = 'https://www.dropbox.com/scl/fi/dljhp6xzshdgvq7vqk3sz/sunsun_final_dialogue_database_proper.db?rlkey=qlf38ydm1b0n0ocsdbpjx0ih8&dl=1';

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
      console.log('Response headers:', response.headers);
      
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
      
      // ファイル内容の最初の部分を確認
      const buffer = fs.readFileSync(dbPath, { encoding: 'utf8' });
      const firstPart = buffer.substring(0, 200);
      console.log('File content start:', firstPart);
      
      reject(new Error(`${errorMsg}. Content: ${firstPart}`));
      return;
    }
    
    // SQLite ファイルかチェック
    const buffer = fs.readFileSync(dbPath, { start: 0, end: 15 });
    const header = buffer.toString();
    
    if (!header.includes('SQLite format 3')) {
      const errorMsg = `Not a valid SQLite file. Header: ${header}`;
      console.error(errorMsg);
      
      // より詳細な情報
      const fullBuffer = fs.readFileSync(dbPath, { encoding: 'utf8' });
      const preview = fullBuffer.substring(0, 500);
      console.log('Full file preview:', preview);
      
      reject(new Error(`${errorMsg}. Preview: ${preview}`));
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

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod === 'GET') {
    try {
      console.log('Starting database download...');
      const dbFile = await downloadDatabase();
      console.log('Database ready at:', dbFile);
      
      return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbFile);
        
        db.get('SELECT COUNT(DISTINCT script_name) as total_scripts FROM dialogues', (err, scriptsResult) => {
          if (err) {
            console.error('Database query error:', err);
            reject(err);
            return;
          }
          
          db.get('SELECT COUNT(*) as total_dialogues FROM dialogues', (err, dialoguesResult) => {
            db.close();
            
            if (err) {
              console.error('Database query error:', err);
              reject(err);
              return;
            }
            
            const response = {
              success: true,
              data: {
                total_scripts: scriptsResult.total_scripts,
                total_dialogues: dialoguesResult.total_dialogues,
                status: 'Database loaded successfully'
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
      console.error('Error in stats handler:', error);
      
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: error.message,
          details: 'Check function logs for more details'
        })
      };
    }
  }

  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({ error: 'Method not allowed' })
  };
};