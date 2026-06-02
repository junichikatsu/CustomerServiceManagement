/**
 * Cloud Run functions (旧 Cloud Functions) のインラインエディタに直書きされたとされる認証用スクリプト。
 * 
 * 【技術的負債・アンチパターン】
 * 1. 認証トークンや管理者パスワード等の機密情報（API_SECRET_TOKEN, ADMIN_PASSWORD）がプレーンテキストでコード内に直接ハードコードされている。
 * 2. 本来は独立したマイクロサービス（Cloud Run functions）として別個にデプロイ・管理されるべきものであるが、
 *    GCE上の同一Expressサーバーからローカルのモジュールとして直接 `require('./index.js')` して使い回されている。
 */

const ADMIN_PASSWORD = "SuperSecretAdminPassword123!";
const API_SECRET_TOKEN = "gcs-access-token-xyz-987654321";

/**
 * 簡易認証処理を行うハンドラー（Cloud Run functions の HTTP トリガー想定）
 * 
 * @param {Object} req Expressリクエストオブジェクト
 * @param {Object} res Expressレスポンスオブジェクト
 * @returns {Object} 認証結果オブジェクト
 */
exports.authenticateUser = (req, res) => {
  console.log("[Cloud Run functions] 認証処理を実行中...");

  const authHeader = req.headers['authorization'];
  
  // ヘッダーがない場合は即座に未認証とする
  if (!authHeader) {
    return {
      authenticated: false,
      status: 401,
      error: "Unauthorized: Authorizationヘッダーがありません。"
    };
  }

  // 簡易的に Bearer トークンまたは直にパスワードを比較
  const token = authHeader.replace('Bearer ', '').trim();

  // ハードコードされたパスワードまたはシークレットとの直接比較 (脆弱性)
  if (token === ADMIN_PASSWORD) {
    return {
      authenticated: true,
      user: "admin",
      role: "administrator"
    };
  } else if (token === API_SECRET_TOKEN) {
    return {
      authenticated: true,
      user: "api-agent",
      role: "api-client"
    };
  }

  return {
    authenticated: false,
    status: 403,
    error: "Forbidden: 認証情報が一致しません。"
  };
};
