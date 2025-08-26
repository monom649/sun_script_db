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
        
        // 全台本名を取得して文字エンコーディング問題をチェック
        const query = `
          SELECT DISTINCT script_name
          FROM dialogues 
          ORDER BY script_name
        `;
        
        db.all(query, (err, rows) => {
          db.close();
          
          if (err) {
            reject(err);
            return;
          }
          
          // 詳細な文字情報を含める - 問題のある台本を特定
          const scripts = rows.map(row => {
            const name = row.script_name;
            const trimmed = name.trim();
            const hasTrailingSpace = name.endsWith(' ');
            const hasLeadingSpace = name.startsWith(' ');
            const hasInternalIssues = name.length !== trimmed.length;
            
            return {
              name: name,
              length: name.length,
              repr: JSON.stringify(name),
              hex: Buffer.from(name, 'utf8').toString('hex'),
              ends_with_space: hasTrailingSpace,
              starts_with_space: hasLeadingSpace,
              has_space_issues: hasInternalIssues,
              trimmed: trimmed,
              trimmed_length: trimmed.length,
              normalized: name.normalize('NFC'),
              normalized_length: name.normalize('NFC').length
            };
          });
          
          // 問題のあるスクリプト名を特定
          const problematicScripts = scripts.filter(s => 
            s.has_space_issues || 
            s.length !== s.normalized_length ||
            s.name !== s.normalized
          );
          
          resolve({
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              total_scripts: scripts.length,
              problematic_count: problematicScripts.length,
              problematic_scripts: problematicScripts,
              all_scripts: scripts.slice(0, 10), // 最初の10件のみ表示
              analysis: {
                total_with_trailing_spaces: scripts.filter(s => s.ends_with_space).length,
                total_with_leading_spaces: scripts.filter(s => s.starts_with_space).length,
                total_with_normalization_issues: scripts.filter(s => s.length !== s.normalized_length).length
              }
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