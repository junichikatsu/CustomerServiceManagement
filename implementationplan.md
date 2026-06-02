# カスタマーサポート管理SaaS バックエンド（アンチパターン）実装計画

Google Cloudにおける技術的負債やセキュリティ上のアンチパターンを意図的に盛り込んだ、Node.js（Express）とSQLiteによるカスタマーサポート管理SaaSのバックエンドコードを構築します。

## User Review Required

> [!WARNING]
> 本計画で作成するコードは、**セキュリティや運用保守性の観点から強く非推奨とされるアンチパターン**を意図的に含んでいます。本番環境や機密情報を扱う環境では絶対に使用しないでください。

### 盛り込むアンチパターンと技術的負債の設計

1. **モノリス・ベタ書き構成 (`app.js`)**
   - Expressのサーバー設定、SQLiteのデータベース接続（ローカルファイル `./database.db` への直接接続）、およびすべてのルーティング（問い合わせ一覧・作成、ファイルアップロード、認証連携など）を1つの `app.js` ファイルにベタ書きします。
   - Dockerなどのコンテナ化を全く考慮せず、GCE（Compute Engine）の単一VM上で動かすことのみを前提とします。

2. **パブリックアクセスの許容と直リンクURLのDB保存**
   - 問い合わせに添付するファイルのアップロード処理において、Google Cloud Storage (GCS) のSDKを使用します。
   - ファイルアップロード時にACLを `publicRead` に設定（またはアップロード後に `makePublic()` を実行）し、誰でもアクセス可能な状態にします。
   - DB（SQLite）には、署名付きURL（Signed URL）ではなく、直リンクURL（`https://storage.googleapis.com/[BUCKET_NAME]/[FILE_NAME]`）をそのまま保存します。

3. **コンソール直書き想定のハードコードされた認証スクリプト (`index.js`)**
   - Cloud Run functions（旧 Cloud Functions）のコンソールエディタ上で直接編集・デプロイされたという設定の、独自の認証用スクリプトを `index.js` として作成します。
   - このファイル内に、管理用アカウントのパスワードやシークレット情報がプレーンテキストでハードコードされた検証ロジックを実装します。

---

## Proposed Changes

### Backend Component

#### [NEW] [package.json](file:///c:/Users/P843-2254/Documents/workspace/MyWork/DevOps%C3%97AIAgentHackathon2026/CustomerServiceManagement/package.json)
- 依存関係（`express`, `sqlite3`, `@google-cloud/storage`, `multer`, `dotenv` など）を記述します。

#### [NEW] [app.js](file:///c:/Users/P843-2254/Documents/workspace/MyWork/DevOps%C3%97AIAgentHackathon2026/CustomerServiceManagement/app.js)
- SQLiteのテーブル作成ロジック（`tickets` テーブル、`users` テーブルなど）を起動時に実行。
- 問い合わせ（Ticket）のCRUD APIエンドポイントの実装。
- Multerと `@google-cloud/storage` SDKを使用した、ファイルアップロードおよび一般公開（public-read化）処理とDB保存処理の実装。
- `index.js` の認証関数を読み込み、APIの認証ミドルウェアとして使用する実装。

#### [NEW] [index.js](file:///c:/Users/P843-2254/Documents/workspace/MyWork/DevOps%C3%97AIAgentHackathon2026/CustomerServiceManagement/index.js)
- Cloud Run functions用のエクスポート関数（HTTPトリガー想定）を含み、パスワードがハードコードされた認証ロジックを実装。

---

## Verification Plan

### Automated / Manual Verification
- SQLiteデータベースがローカルファイルとして正常に生成され、テーブルが作成されることを確認。
- パスワード検証（`index.js` のハードコードされたパスワード）を用いて、正常に認証が行えるか動作を確認。
- GCSへのファイルアップロードAPIを叩いた際、ACLが `public-read` に設定され、直リンクURLがレスポンスおよびSQLiteに正常に保存されるロジックになっているかコードレビューで確認。
