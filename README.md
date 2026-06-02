# CustomerServiceManagement (カスタマーサポート管理SaaS バックエンド)

本プロジェクトは、Google Cloudにおける技術的負債やセキュリティ上のアンチパターンを検証・学習するために作成された意図的なデモ用バックエンドコードです。

> [!WARNING]
> 本プロジェクトは、**セキュリティや運用保守性の観点から強く非推奨とされる構成**（シークレットのハードコード、GCSファイルのパブリック公開、VM1台に依存したモノリスSQLite構成）を意図的に含んでいます。本番環境や機密情報を扱う環境では絶対に使用しないでください。

## 前提条件

- Node.js (v18以上推奨)
- Google Cloud プロジェクト (GCSアップロード機能の実環境テスト用。未設定時はダミーURLが生成されるフォールバック機能が作動します)

## 起動手順

### 1. 依存パッケージのインストール

プロジェクトルートディレクトリで以下のコマンドを実行し、パッケージをインストールします。

```bash
# 通常のシェル環境
npm install

# Windows PowerShell で実行ポリシーのエラー（UnauthorizedAccess）が出る場合
cmd.exe /c npm install
```

### 2. 環境変数の設定 (オプション)

必要に応じて、プロジェクトルートに `.env` ファイルを作成し、環境変数を設定します。設定しない場合はデフォルト値またはダミーの挙動にフォールバックします。

```env
PORT=3000
GCS_BUCKET_NAME=your-gcs-bucket-name
GOOGLE_APPLICATION_CREDENTIALS=path/to/your/service-account-key.json
```

### 3. アプリケーションの起動

以下のコマンドでExpressサーバーを起動します。

```bash
npm start
```

起動が成功すると、SQLiteデータベースファイル（`database.db`）が自動で生成され、ローカルサーバーが `http://localhost:3000` でリッスンを開始します。

## 主な API エンドポイントとテスト方法

このバックエンドは、Cloud Run functionsを模した認証モジュールによる簡易認証ヘッダーを要求します。

### 1. 問い合わせ一覧取得
- **メソッド / パス**: `GET /api/tickets`
- **認証**: 不要
- **コマンド例**:
  ```bash
  curl http://localhost:3000/api/tickets
  ```

### 2. 問い合わせの新規作成
- **メソッド / パス**: `POST /api/tickets`
- **認証**: 必要（Authorization ヘッダー）
- **ヘッダー**: `Authorization: Bearer SuperSecretAdminPassword123!`
- **ボディ (JSON)**:
  ```json
  {
    "title": "ログインできない",
    "description": "本番環境の管理画面にログインできません。"
  }
  ```
- **コマンド例**:
  ```bash
  curl -X POST http://localhost:3000/api/tickets \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer SuperSecretAdminPassword123!" \
    -d "{\"title\":\"ログインできない\",\"description\":\"本番環境の管理画面にログインできません。\"}"
  ```

### 3. 問い合わせに対するファイルのアップロード
- **メソッド / パス**: `POST /api/tickets/:id/upload`
- **認証**: 必要（Authorization ヘッダー）
- **ヘッダー**: `Authorization: Bearer SuperSecretAdminPassword123!`
- **フォームデータ (multipart/form-data)**:
  - `file`: アップロードするファイル
- **挙動**: アップロードされたファイルはGCSへ一般公開（`public-read`）状態で保存され、DBには直リンクURLが記録されます。（GCS接続未設定時はダミーURLが登録されます）
