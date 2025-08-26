const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Dropbox直接ダウンロードURL
const DROPBOX_URL = 'https://www.dropbox.com/scl/fi/thzlrt9skagtyfbx8rm0h/sunsun_final_dialogue_database_with_urls.db?rlkey=3f2nhbuk0g1m4d62qn4lss71u&st=1igvqg04&dl=1';

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  try {
    // URL検証とダウンロード試行
    const debugInfo = await new Promise((resolve, reject) => {
      const info = {
        url: DROPBOX_URL,
        redirects: [],
        fileSize: 0,
        contentType: '',
        firstBytes: '',
        error: null
      };
      
      const testPath = path.join(os.tmpdir(), 'debug_test.db');
      const file = fs.createWriteStream(testPath);
      
      const request = https.get(DROPBOX_URL, (response) => {
        info.statusCode = response.statusCode;
        info.contentType = response.headers['content-type'] || '';
        
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          info.redirects.push(response.headers.location);
          
          const redirectRequest = https.get(response.headers.location, (redirectResponse) => {
            info.finalStatusCode = redirectResponse.statusCode;
            info.finalContentType = redirectResponse.headers['content-type'] || '';
            
            let firstChunk = true;
            redirectResponse.on('data', (chunk) => {
              if (firstChunk) {
                info.firstBytes = chunk.toString('hex').substring(0, 32);
                firstChunk = false;
              }
            });
            
            redirectResponse.pipe(file);
            file.on('finish', () => {
              file.close();
              try {
                const stats = fs.statSync(testPath);
                info.fileSize = stats.size;
                fs.unlinkSync(testPath); // 削除
                resolve(info);
              } catch (err) {
                info.error = err.message;
                resolve(info);
              }
            });
          });
          
          redirectRequest.on('error', (err) => {
            info.error = err.message;
            resolve(info);
          });
        } else {
          let firstChunk = true;
          response.on('data', (chunk) => {
            if (firstChunk) {
              info.firstBytes = chunk.toString('hex').substring(0, 32);
              firstChunk = false;
            }
          });
          
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            try {
              const stats = fs.statSync(testPath);
              info.fileSize = stats.size;
              fs.unlinkSync(testPath); // 削除
              resolve(info);
            } catch (err) {
              info.error = err.message;
              resolve(info);
            }
          });
        }
      });
      
      request.on('error', (err) => {
        info.error = err.message;
        resolve(info);
      });
      
      file.on('error', (err) => {
        info.error = err.message;
        resolve(info);
      });
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        debug: debugInfo,
        expectedFileSize: '> 100MB',
        expectedFirstBytes: 'SQLite header should start with 53514c69746520666f726d6174203320'
      })
    };

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
};