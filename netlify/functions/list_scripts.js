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
      const stats = fs.statSync(dbPath);
      if (stats.size > 1000000) {
        resolve(dbPath);
        return;
      }
    }

    dbPath = path.join(os.tmpdir(), `sunsun_database_${Date.now()}.db`);
    
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
        
        // B2231を含む台本名をすべて取得
        const query = `
          SELECT DISTINCT script_name
          FROM dialogues 
          WHERE script_name LIKE '%B2231%'
          ORDER BY script_name
        `;
        
        db.all(query, (err, rows) => {
          db.close();
          
          if (err) {
            reject(err);
            return;
          }
          
          // 詳細な文字情報を含める
          const scripts = rows.map(row => {
            const name = row.script_name;
            return {
              name: name,
              length: name.length,
              repr: JSON.stringify(name),
              hex: Buffer.from(name, 'utf8').toString('hex'),
              ends_with_space: name.endsWith(' '),
              trimmed: name.trim(),
              trimmed_length: name.trim().length
            };
          });
          
          resolve({
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              total_found: scripts.length,
              scripts: scripts,
              search_term: 'B2231'
            })
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