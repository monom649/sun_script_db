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
      resolve(dbPath);
      return;
    }

    dbPath = path.join(os.tmpdir(), 'sunsun_database.db');
    
    const file = fs.createWriteStream(dbPath);
    
    const request = https.get(DROPBOX_URL, (response) => {
      // リダイレクトをフォロー
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectUrl = response.headers.location;
        console.log('Redirected to:', redirectUrl);
        
        const redirectRequest = https.get(redirectUrl, (redirectResponse) => {
          redirectResponse.pipe(file);
          file.on('finish', () => {
            file.close();
            console.log('Database downloaded successfully, size:', fs.statSync(dbPath).size);
            resolve(dbPath);
          });
        });
        
        redirectRequest.on('error', (err) => {
          console.error('Redirect request error:', err);
          reject(err);
        });
      } else {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log('Database downloaded successfully, size:', fs.statSync(dbPath).size);
          resolve(dbPath);
        });
      }
    });
    
    request.on('error', (err) => {
      console.error('Download error:', err);
      reject(err);
    });
    
    file.on('error', (err) => {
      console.error('File write error:', err);
      reject(err);
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
      // データベースをダウンロード
      const dbFile = await downloadDatabase();
      
      return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbFile);
        
        // 基本統計を取得
        db.get('SELECT COUNT(DISTINCT script_name) as total_scripts FROM dialogues', (err, scriptsResult) => {
          if (err) {
            reject(err);
            return;
          }
          
          db.get('SELECT COUNT(*) as total_dialogues FROM dialogues', (err, dialoguesResult) => {
            db.close();
            
            if (err) {
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
      
      const response = {
        success: false,
        error: error.message
      };
      
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify(response)
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