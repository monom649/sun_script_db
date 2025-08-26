// サンサンキッズTV台本データベース JavaScript

// データベース接続
let db = null;
let currentResults = [];

// データベースURL - CORS制限回避のためCORSプロキシ経由でアクセス
const DROPBOX_URL = 'https://www.dropbox.com/scl/fi/eiiw2sav60woxr2ndrhqz/sunsun_final_dialogue_database_proper.db?rlkey=jnymntxo6ns7xdjv5fs21xok2&st=0tj8igi4&dl=1';

// 複数のCORSプロキシを準備（フォールバック用）
const CORS_PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?',
    'https://api.codetabs.com/v1/proxy?quest='
];

// ページ読み込み時の初期化
document.addEventListener('DOMContentLoaded', async function() {
    setupSearchHandlers();
    await initDatabase();
});

// データベース初期化
async function initDatabase() {
    try {
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('results').innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <div style="font-size: 1.2rem; margin-bottom: 20px;">🌞 データベース初期化中...</div>
                <div style="color: #666; margin-bottom: 10px;">サーバーサイドでDropboxデータベースを読み込んでいます</div>
                <div style="color: #666;">初回のみ時間がかかります。しばらくお待ちください。</div>
                <div id="init-status" style="margin-top: 20px; color: #999;"></div>
            </div>
        `;
        
        const statusDiv = document.getElementById('init-status');
        statusDiv.textContent = 'データベース統計を確認中...';
        
        // サーバーサイドAPIでデータベース統計を確認
        // Netlify Functions のパスを使用
        const apiPath = window.location.hostname.includes('netlify') 
            ? '/.netlify/functions/stats'
            : '/api/stats';
        const response = await fetch(apiPath);
        const data = await response.json();
        
        if (data.success) {
            db = true;
            document.getElementById('results').innerHTML = `
                <div style="text-align: center; padding: 40px; color: green;">
                    <div style="font-size: 1.2rem; margin-bottom: 10px;">✅ データベース初期化完了！</div>
                    <div style="color: #666;">台本数: ${data.data.total_scripts}件</div>
                    <div style="color: #666;">セリフ数: ${data.data.total_dialogues}件</div>
                    <div style="color: #999; margin-top: 15px;">検索キーワードを入力してください</div>
                </div>
            `;
            console.log('実データベース初期化完了:', data.data);
        } else {
            throw new Error(data.error);
        }
        
    } catch (error) {
        console.error('データベース初期化エラー:', error);
        hideLoading();
        document.getElementById('results').innerHTML = `
            <div style="color: red; padding: 20px;">
                <h3>データベース読み込みエラー</h3>
                <p>エラー内容: ${error.message}</p>
                <p>ブラウザのデベロッパーツールのコンソールで詳細を確認してください。</p>
                <button onclick="location.reload()">ページを再読み込み</button>
            </div>
        `;
    }
}

// タブ機能の初期化
function initializeTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const tabId = this.dataset.tab;
            
            // アクティブタブの切り替え
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            this.classList.add('active');
            document.getElementById(tabId + '-tab').classList.add('active');
        });
    });
}

// 検索ハンドラーの設定
function setupSearchHandlers() {
    // Enter キーで検索
    document.getElementById('keyword-search').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') searchByKeyword();
    });
}

// キャラクター統計の読み込み
async function loadCharacterStats() {
    try {
        // 実際のAPIが実装されるまでの模擬データ
        const stats = {
            'サンサン': 85420,
            'くもりん': 62150,
            'ノイズ': 38940,
            'プリル': 29820
        };
        
        document.getElementById('sunsan-count').textContent = `${stats['サンサン'].toLocaleString()}件`;
        document.getElementById('kumorin-count').textContent = `${stats['くもりん'].toLocaleString()}件`;
        document.getElementById('noise-count').textContent = `${stats['ノイズ'].toLocaleString()}件`;
        document.getElementById('priru-count').textContent = `${stats['プリル'].toLocaleString()}件`;
    } catch (error) {
        console.error('統計データ取得エラー:', error);
    }
}

// 台本検索
async function searchScripts() {
    const query = document.getElementById('script-search').value.trim();
    const theme = document.getElementById('theme-filter').value;
    const year = document.getElementById('year-filter').value;
    
    if (!query && !theme && !year) {
        clearResults();
        return;
    }
    
    showLoading();
    
    try {
        // APIが実装されるまでの模擬検索結果
        const results = await mockScriptSearch(query, theme, year);
        displayResults(results);
    } catch (error) {
        console.error('検索エラー:', error);
        showNoResults();
    }
}

// キーワード検索
async function searchByKeyword() {
    const keyword = document.getElementById('keyword-search').value.trim();
    
    if (!keyword) {
        clearResults();
        return;
    }
    
    if (!db) {
        alert('データベースが読み込まれていません。しばらくお待ちください。');
        return;
    }
    
    showLoading();
    
    try {
        // サーバーサイドAPIで実際のデータベース検索
        // Netlify Functions のパスを使用
        const apiPath = window.location.hostname.includes('netlify')
            ? `/.netlify/functions/search?q=${encodeURIComponent(keyword)}`
            : `/api/search?q=${encodeURIComponent(keyword)}`;
        const response = await fetch(apiPath);
        const data = await response.json();
        
        if (data.success) {
            displayKeywordResults(data.data, data.keyword);
        } else {
            console.error('API Error:', data.error);
            showNoResults();
        }
    } catch (error) {
        console.error('検索エラー:', error);
        showNoResults();
    }
}

// データベース検索
async function searchDatabase(keyword) {
    const query = `
        SELECT DISTINCT 
            script_name,
            script_url,
            GROUP_CONCAT(DISTINCT character) as characters,
            release_date,
            youtube_title,
            youtube_url,
            COUNT(*) as match_count
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
        GROUP BY script_name, release_date, youtube_title, youtube_url, script_url
        ORDER BY match_count DESC, release_date DESC
        LIMIT 50
    `;
    
    const keywordParam = `%${keyword}%`;
    const params = [keywordParam, keywordParam, keywordParam, keywordParam, keywordParam];
    
    const stmt = db.prepare(query);
    stmt.bind(params);
    
    const results = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push({
            script_name: row.script_name || '',
            script_url: row.script_url || '',
            characters: row.characters || '',
            release_date: row.release_date || '',
            youtube_title: row.youtube_title || '',
            youtube_url: row.youtube_url || '',
            youtube_release_date: row.release_date || '',
            match_count: row.match_count || 0
        });
    }
    
    stmt.free();
    return results;
}

// セリフ検索
async function searchDialogues() {
    const query = document.getElementById('dialogue-search').value.trim();
    const character = document.getElementById('character-filter').value;
    
    if (!query && !character) {
        clearResults();
        return;
    }
    
    showLoading();
    
    try {
        // APIが実装されるまでの模擬検索結果
        const results = await mockDialogueSearch(query, character);
        displayResults(results);
    } catch (error) {
        console.error('検索エラー:', error);
        showNoResults();
    }
}

// キャラクター別フィルター
function filterByCharacter(character) {
    document.getElementById('character-filter').value = character;
    // タブをセリフ検索に切り替え
    document.querySelector('[data-tab="dialogue"]').click();
    searchDialogues();
}

// 模擬台本検索
async function mockScriptSearch(query, theme, year) {
    return new Promise((resolve) => {
        setTimeout(() => {
            const mockResults = [
                {
                    id: 1,
                    script_name: 'B1378 新幹線ロボット対決！ドクターイエローVSはやぶさ！',
                    themes: '乗り物・遊び',
                    release_date: '2021-11-20',
                    youtube_title: '新幹線ロボット対決！ドクターイエローVSはやぶさ！シンカリオンみたいな最強ロボに変形！',
                    youtube_url: 'https://www.youtube.com/watch?v=I95scL7u3CM',
                    match_confidence: 0.99,
                    dialogue_count: 188
                },
                {
                    id: 2,
                    script_name: 'B1383 ねじねじ建築対決！大工さんごっこ ロボットツールボックス',
                    themes: '工作・DIY',
                    release_date: '2023-03-20',
                    youtube_title: 'ブロックをねじねじ組み立てて大工さんごっこ♪ドライバーやドリルで最強ロボットをDIY！',
                    youtube_url: 'https://www.youtube.com/watch?v=XWLuMvSog3E',
                    match_confidence: 0.92,
                    dialogue_count: 144
                },
                {
                    id: 3,
                    script_name: 'B1470_ネオスコラボ',
                    themes: 'コラボ・特別企画',
                    release_date: '2022-02-26',
                    youtube_title: 'お姫様が誘拐された！？謎を解いてプリンセスを取り戻せ！サンサンネオスコラボ【前編】',
                    youtube_url: 'https://www.youtube.com/watch?v=5bYWBaxu-Xw',
                    match_confidence: 0.99,
                    dialogue_count: 144
                }
            ];
            
            // 簡易フィルタリング
            let filtered = mockResults;
            if (query) {
                filtered = filtered.filter(r => 
                    r.script_name.toLowerCase().includes(query.toLowerCase()) ||
                    r.youtube_title.toLowerCase().includes(query.toLowerCase())
                );
            }
            if (theme) {
                filtered = filtered.filter(r => r.themes.includes(theme));
            }
            if (year) {
                filtered = filtered.filter(r => r.release_date.startsWith(year));
            }
            
            resolve(filtered);
        }, 800);
    });
}

// 模擬キーワード検索
async function mockKeywordSearch(keyword) {
    return new Promise((resolve) => {
        setTimeout(() => {
            const mockResults = [
                {
                    script_name: 'B1378 新幹線ロボット対決！ドクターイエローVSはやぶさ！',
                    script_url: '',
                    characters: 'サンサン, くもりん, ノイズ',
                    release_date: '2021-11-20',
                    youtube_title: '新幹線ロボット対決！ドクターイエローVSはやぶさ！シンカリオンみたいな最強ロボに変形！',
                    youtube_url: 'https://www.youtube.com/watch?v=I95scL7u3CM',
                    youtube_release_date: '2021-11-20',
                    match_count: 8
                },
                {
                    script_name: 'B1387 かずのドーナツ屋さん',
                    script_url: '',
                    characters: 'サンサン, ツクモ',
                    release_date: '2024-06-21',
                    youtube_title: '顔がミスドのドーナツになっちゃった！？どーなつにチョコやお菓子をデコレーション♪',
                    youtube_url: 'https://www.youtube.com/watch?v=cfuDag4k_ic',
                    youtube_release_date: '2024-06-21',
                    match_count: 5
                },
                {
                    script_name: 'B1383 ねじねじ建築対決！大工さんごっこ ロボットツールボックス',
                    script_url: '',
                    characters: 'サンサン, くもりん, プリル',
                    release_date: '2023-03-20',
                    youtube_title: 'ブロックをねじねじ組み立てて大工さんごっこ♪ドライバーやドリルで最強ロボットをDIY！',
                    youtube_url: 'https://www.youtube.com/watch?v=XWLuMvSog3E',
                    youtube_release_date: '2023-03-20',
                    match_count: 12
                },
                {
                    script_name: 'B1470 ネオスコラボ',
                    script_url: '',
                    characters: 'サンサン, プリンセス',
                    release_date: '2022-02-26',
                    youtube_title: 'お姫様が誘拐された！？謎を解いてプリンセスを取り戻せ！サンサンネオスコラボ【前編】',
                    youtube_url: 'https://www.youtube.com/watch?v=5bYWBaxu-Xw',
                    youtube_release_date: '2022-02-26',
                    match_count: 6
                }
            ];
            
            // キーワードでフィルタリング
            let filtered = mockResults;
            if (keyword) {
                const keywordLower = keyword.toLowerCase();
                filtered = mockResults.filter(r => 
                    r.script_name.toLowerCase().includes(keywordLower) ||
                    r.youtube_title.toLowerCase().includes(keywordLower) ||
                    r.characters.toLowerCase().includes(keywordLower)
                );
            }
            
            resolve(filtered);
        }, 800);
    });
}

// 模擬セリフ検索
async function mockDialogueSearch(query, character) {
    return new Promise((resolve) => {
        setTimeout(() => {
            const mockResults = [
                {
                    id: 1,
                    script_name: 'B1387 かずのドーナツ屋さん',
                    character: 'サンサン',
                    dialogue: '今日から開くドーナツやさん！',
                    themes: '料理・お店屋さん',
                    release_date: '2024-06-21',
                    youtube_title: '顔がミスドのドーナツになっちゃった！？どーなつにチョコやお菓子をデコレーション♪',
                    youtube_url: 'https://www.youtube.com/watch?v=cfuDag4k_ic',
                    match_confidence: 0.85,
                    row_number: 15
                },
                {
                    id: 2,
                    script_name: 'B1395 誰のお弁当が1番？おばけお弁当作り対決！',
                    character: 'ツクモ',
                    dialogue: '今日はみんなでおばけのお弁当作り対決をしましょう！',
                    themes: '料理・対決',
                    release_date: '2024-09-30',
                    youtube_title: '本物そっくりなお菓子のお弁当箱！？',
                    youtube_url: 'https://www.youtube.com/watch?v=7uW4FX1seVk',
                    match_confidence: 0.80,
                    row_number: 8
                }
            ];
            
            // 簡易フィルタリング
            let filtered = mockResults;
            if (query) {
                filtered = filtered.filter(r => 
                    r.dialogue.toLowerCase().includes(query.toLowerCase())
                );
            }
            if (character) {
                filtered = filtered.filter(r => r.character === character);
            }
            
            resolve(filtered);
        }, 800);
    });
}

// キーワード検索結果表示
function displayKeywordResults(results, keyword) {
    hideLoading();
    
    if (results.length === 0) {
        showNoResults();
        return;
    }
    
    hideNoResults();
    currentResults = results;
    
    const resultsContainer = document.getElementById('results');
    resultsContainer.innerHTML = `<h3>キーワード「${keyword}」の検索結果 (${results.length}件)</h3>`;
    
    results.forEach(result => {
        const card = createKeywordResultCard(result);
        resultsContainer.appendChild(card);
    });
}

// 結果表示
function displayResults(results) {
    hideLoading();
    
    if (results.length === 0) {
        showNoResults();
        return;
    }
    
    hideNoResults();
    currentResults = results;
    
    const resultsContainer = document.getElementById('results');
    resultsContainer.innerHTML = '';
    
    results.forEach(result => {
        const card = createResultCard(result);
        resultsContainer.appendChild(card);
    });
}

// キーワード検索結果カード作成
function createKeywordResultCard(result) {
    const card = document.createElement('div');
    card.className = 'keyword-result-card clickable-card';
    
    // セリフ部分の生成（代表セリフのみ）
    let dialoguesHTML = '';
    if (result.dialogues && result.dialogues.length > 0) {
        dialoguesHTML = result.dialogues.map(d => `
            <div class="dialogue-item">
                <span class="dialogue-meta">${d.character || '不明'} (${d.row_number}行目):</span>
                <span class="dialogue-text">"${d.dialogue}"</span>
            </div>
        `).join('');
    }
    
    // 詳細ページへのリンクを作成
    const currentKeyword = document.getElementById('keyword-search').value.trim();
    const detailUrl = `detail.html?script_name=${encodeURIComponent(result.script_name)}&keyword=${encodeURIComponent(currentKeyword)}`;
    
    card.innerHTML = `
        <div class="keyword-result-title">
            <a href="${detailUrl}" class="script-title-link" onclick="event.stopPropagation()">${result.script_name}</a>
        </div>
        
        <div class="keyword-result-links">
            ${result.script_url ? `<a href="${result.script_url}" target="_blank" class="script-link" onclick="event.stopPropagation()">📄 台本</a>` : ''}
            ${result.youtube_url ? `<a href="${result.youtube_url}" target="_blank" class="youtube-link" onclick="event.stopPropagation()">🎬 ${result.youtube_title}</a>` : ''}
        </div>
        
        <div class="keyword-result-meta">
            <span class="meta-item">📅 ${result.release_date || '不明'}</span>
            <span class="meta-item">👥 ${result.characters || '不明'}</span>
            <span class="meta-item">🔍 ${result.match_count}件マッチ</span>
        </div>
        
        ${dialoguesHTML ? `
            <div class="dialogues-section">
                <div class="dialogues-title">代表セリフ:</div>
                ${dialoguesHTML}
                ${result.match_count > result.dialogues.length ? `
                    <div class="more-dialogues">... 他 ${result.match_count - result.dialogues.length}件のセリフ</div>
                ` : ''}
            </div>
        ` : ''}
        
        <div class="detail-link">
            <span>クリックで詳細を表示 →</span>
        </div>
    `;
    
    // クリックイベントを追加
    card.addEventListener('click', function() {
        window.location.href = detailUrl;
    });
    
    return card;
}

// 結果カード作成
function createResultCard(result) {
    const card = document.createElement('div');
    card.className = 'result-card';
    
    const confidenceBadgeClass = getConfidenceBadgeClass(result.match_confidence);
    
    card.innerHTML = `
        <div class="result-title">${result.script_name}</div>
        <div class="result-meta">
            <span>📅 ${result.release_date}</span>
            <span>🎭 ${result.themes}</span>
            ${result.dialogue_count ? `<span>💬 ${result.dialogue_count}セリフ</span>` : ''}
            ${result.character ? `<span>👤 ${result.character}</span>` : ''}
            ${result.row_number ? `<span>📍 ${result.row_number}行目</span>` : ''}
        </div>
        ${result.dialogue ? `<div class="result-dialogue">"${result.dialogue}"</div>` : ''}
        <div class="result-youtube">
            <a href="${result.youtube_url}" target="_blank" class="youtube-link">
                🎬 ${result.youtube_title}
            </a>
            <div class="confidence-badge ${confidenceBadgeClass}">
                ${Math.round(result.match_confidence * 100)}%
            </div>
        </div>
    `;
    
    return card;
}

// 信頼度バッジのクラス取得
function getConfidenceBadgeClass(confidence) {
    if (confidence >= 0.8) return 'high-confidence';
    if (confidence >= 0.5) return 'medium-confidence';
    return 'low-confidence';
}

// ローディング表示
function showLoading() {
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('results').innerHTML = '';
    document.getElementById('no-results').classList.add('hidden');
}

// ローディング非表示
function hideLoading() {
    document.getElementById('loading').classList.add('hidden');
}

// 結果なし表示
function showNoResults() {
    hideLoading();
    document.getElementById('no-results').classList.remove('hidden');
    document.getElementById('results').innerHTML = '';
}

// 結果なし非表示
function hideNoResults() {
    document.getElementById('no-results').classList.add('hidden');
}

// 結果クリア
function clearResults() {
    if (db) {
        // データベース初期化済みの場合は空にする
        document.getElementById('results').innerHTML = '';
    }
    // 初期化中の場合は表示を維持
    hideLoading();
    hideNoResults();
    currentResults = [];
}

// 検索結果のエクスポート機能（今後実装）
function exportResults(format) {
    if (currentResults.length === 0) {
        alert('検索結果がありません');
        return;
    }
    
    // CSV/JSON形式でのエクスポート機能を今後実装
    console.log('エクスポート:', format, currentResults);
}

// 統計情報の更新
function updateStats() {
    // 実際のAPIから最新統計を取得して更新
    loadCharacterStats();
}