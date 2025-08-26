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
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectUrl = response.headers.location.startsWith('http') 
          ? response.headers.location 
          : 'https:' + response.headers.location;
        
        const redirectRequest = https.get(redirectUrl, options, (redirectResponse) => {
          if (redirectResponse.statusCode >= 300 && redirectResponse.statusCode < 400 && redirectResponse.headers.location) {
            const finalUrl = redirectResponse.headers.location.startsWith('http') 
              ? redirectResponse.headers.location 
              : 'https:' + redirectResponse.headers.location;
            
            const finalRequest = https.get(finalUrl, options, (finalResponse) => {
              finalResponse.pipe(file);
              file.on('finish', () => {
                file.close();
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

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod === 'GET') {
    try {
      const dbFile = await downloadDatabase();
      
      return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbFile);
        
        // script_urlの状態を確認
        const query = `
          SELECT 
            script_name,
            script_url,
            COUNT(*) as dialogue_count
          FROM dialogues 
          WHERE script_url IS NOT NULL AND script_url != ''
          GROUP BY script_name, script_url
          ORDER BY script_name
          LIMIT 20
        `;
        
        db.all(query, (err, rows) => {
          if (err) {
            db.close();
            reject(err);
            return;
          }
          
          // 全台本数も確認
          db.get('SELECT COUNT(DISTINCT script_name) as total_scripts FROM dialogues', (err2, totalResult) => {
            db.close();
            
            if (err2) {
              reject(err2);
              return;
            }
            
            resolve({
              statusCode: 200,
              headers,
              body: JSON.stringify({
                success: true,
                total_scripts: totalResult.total_scripts,
                scripts_with_url: rows.length,
                sample_script_urls: rows,
                message: rows.length > 0 ? 'script_urlが存在します' : 'script_urlは空です'
              })
            });
          });
        });
      });
      
    } catch (error) {
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

  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({ error: 'Method not allowed' })
  };
};