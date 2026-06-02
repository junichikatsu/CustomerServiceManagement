/**
 * カスタマーサポート管理SaaS バックエンドメインプログラム
 * 
 * 【技術的負債・アンチパターン】
 * 1. モノリス構造: サーバー設定、SQLite接続、テーブル定義、ビジネスロジック、
 *    すべてのルーティングをこの `app.js` 1ファイルにベタ書きしている。
 * 2. 単一GCE前提: データベースにローカルの SQLite ファイル (`./database.db`) を使用しており、
 *    Dockerの考慮や複数インスタンスへのスケールアウト (負荷分散) を考慮していない。
 * 3. セキュリティリスク: GCSにアップロードされた添付ファイルを一般公開 (`public-read` / `makePublic`) とし、
 *    認証不要で誰でも閲覧可能な直リンクURL (`https://storage.googleapis.com/...`) をDBに登録している。
 * 4. 依存の歪み: Cloud Run functions (インライン) のはずの `index.js` 認証スクリプトを
 *    ローカルのモジュールとして `require` して直接ミドルウェアとして使用している。
 */

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// 独自の認証用スクリプトを直接 require して使用する負債設計
const { authenticateUser } = require('./index');

const app = express();
app.use(express.json());

// Express起動時に一時ファイル保存用フォルダを作成
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

// 1. SQLiteのDB接続 (ローカルファイルへの直接書き込み)
const DB_FILE = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error('[Database Error] SQLiteデータベースの起動に失敗しました:', err.message);
  } else {
    console.log('[Database] SQLiteデータベースに正常に接続しました (ローカルファイル):', DB_FILE);
  }
});

// テーブルの初期化
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'OPEN',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      file_url TEXT
    )
  `);
  console.log('[Database] tickets テーブルの初期化が完了しました。');
});

// 2. 認証ミドルウェア (Cloud Run functions をモックした認証関数のラッパー)
const checkAuth = (req, res, next) => {
  const result = authenticateUser(req, res);
  if (result.authenticated) {
    req.user = result.user;
    req.role = result.role;
    next();
  } else {
    res.status(result.status || 401).json({ error: result.error });
  }
};

// 3. GCS クライアント初期化
// GCE上、またはローカルに credentials が設定されていれば自動で読み込む
const storage = new Storage({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
});
const bucketName = process.env.GCS_BUCKET_NAME || 'my-app-support-attachments';

// ローカルに一時保存するためのmulter設定
const upload = multer({ dest: 'uploads/' });


// ==========================================
// API エンドポイント定義
// ==========================================

// 問い合わせ一覧取得 (認証不要)
app.get('/api/tickets', (req, res) => {
  db.all('SELECT * FROM tickets ORDER BY created_at DESC', [], (err, rows) => {
    if (err) {
      console.error('[API Error] 一覧取得失敗:', err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// 問い合わせ詳細取得 (認証不要)
app.get('/api/tickets/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM tickets WHERE id = ?', [id], (err, row) => {
    if (err) {
      console.error('[API Error] 詳細取得失敗:', err.message);
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: '指定された問い合わせが見つかりません。' });
    }
    res.json(row);
  });
});

// 問い合わせ作成 (認証要 - ハードコードされた認証パスワードが必要)
app.post('/api/tickets', checkAuth, (req, res) => {
  const { title, description } = req.body;
  if (!title || !description) {
    return res.status(400).json({ error: 'タイトルと説明は必須です。' });
  }

  db.run(
    'INSERT INTO tickets (title, description) VALUES (?, ?)',
    [title, description],
    function (err) {
      if (err) {
        console.error('[API Error] 問い合わせ作成失敗:', err.message);
        return res.status(500).json({ error: err.message });
      }
      console.log(`[API] 問い合わせが作成されました。ID: ${this.lastID}`);
      res.status(201).json({
        id: this.lastID,
        title,
        description,
        status: 'OPEN'
      });
    }
  );
});

// ファイルアップロードとGCSへのパブリックアップロード処理 (認証要)
app.post('/api/tickets/:id/upload', checkAuth, upload.single('file'), async (req, res) => {
  const ticketId = req.params.id;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'アップロードするファイルが指定されていません。' });
  }

  // 問い合わせの存在確認
  db.get('SELECT * FROM tickets WHERE id = ?', [ticketId], async (err, row) => {
    if (err) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(404).json({ error: '指定された問い合わせが見つかりません。' });
    }

    try {
      const destination = `attachments/ticket-${ticketId}/${Date.now()}-${file.originalname}`;
      const bucket = storage.bucket(bucketName);
      
      console.log(`[GCS] ${bucketName} にファイルをアップロード中... Target: ${destination}`);
      
      // 【アンチパターン】
      // ファイルアップロード時に 'publicRead' を指定し、全インターネットユーザーに読み取り権限を開放
      const [uploadedFile] = await bucket.upload(file.path, {
        destination: destination,
        predefinedAcl: 'publicRead',
        metadata: {
          cacheControl: 'no-cache'
        }
      });

      // 【アンチパターン】
      // 念押しで makePublic() を明示的に実行し、確実にパブリックアクセス可能な状態にする
      await uploadedFile.makePublic();

      // アップロード完了後、ローカルの一時ファイルを削除
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }

      // 【アンチパターン】
      // パブリック直リンクURLを構築してDBにそのまま保存する
      const publicUrl = `https://storage.googleapis.com/${bucketName}/${destination}`;
      
      db.run(
        'UPDATE tickets SET file_url = ? WHERE id = ?',
        [publicUrl, ticketId],
        function (dbErr) {
          if (dbErr) {
            console.error('[API Error] DBのfile_url更新失敗:', dbErr.message);
            return res.status(500).json({ error: dbErr.message });
          }
          console.log(`[API] 問い合わせ ID: ${ticketId} にパブリック直リンクを保存しました: ${publicUrl}`);
          res.json({
            message: 'ファイルのアップロードと公開設定が完了しました。',
            file_url: publicUrl
          });
        }
      );

    } catch (gcsError) {
      console.error('[GCS Error] ファイルアップロード中にエラーが発生しました:', gcsError.message);
      
      // 一時ファイルの削除
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }

      // 開発環境や資格情報がセットアップされていない場合でも動作確認が行えるよう、
      // 警告を出しつつダミーの直リンクURLをDBに登録して処理を続行する（フォールバック）
      console.warn('[GCS Warning] GCS接続エラーのため、ダミーURLで登録処理を続行します。');
      const dummyUrl = `https://storage.googleapis.com/${bucketName}/attachments/ticket-${ticketId}/dummy-${Date.now()}-${file.originalname}`;
      
      db.run(
        'UPDATE tickets SET file_url = ? WHERE id = ?',
        [dummyUrl, ticketId],
        function (dbErr) {
          if (dbErr) {
            return res.status(500).json({ error: dbErr.message });
          }
          res.json({
            message: '【フォールバック】GCSに接続できなかったため、ダミーの直リンクURLを登録しました。',
            file_url: dummyUrl,
            error: gcsError.message
          });
        }
      );
    }
  });
});

// サーバー起動処理
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`=============================================================`);
  console.log(`  カスタマーサポート管理SaaS バックエンド (アンチパターン)`);
  console.log(`  起動完了: http://localhost:${PORT}`);
  console.log(`  データベース: ${DB_FILE}`);
  console.log(`  環境設定: GCE Single Instance Mode (No Docker)`);
  console.log(`=============================================================`);
});

module.exports = app; // テスト用
