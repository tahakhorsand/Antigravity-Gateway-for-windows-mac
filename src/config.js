import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// OAuth client used to refresh the pooled accounts' tokens. Kept out of git:
// set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET, or create oauth-client.json
// (see oauth-client.example.json).
function loadOAuthClient() {
  let clientId = '';
  let clientSecret = '';

  if (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    clientId = process.env.GOOGLE_OAUTH_CLIENT_ID.trim();
    clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET.trim();
  } else {
    const file = path.resolve(__dirname, '../oauth-client.json');
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.client_id && data.client_secret) {
        clientId = String(data.client_id).trim();
        clientSecret = String(data.client_secret).trim();
      }
    } catch { /* fall through */ }
  }

  // Ensure client_id starts with the numeric project ID digits and ends with .apps.googleusercontent.com
  const match = clientId.match(/\d+-[a-z0-9_-]+\.apps\.googleusercontent\.com/i);
  if (match) {
    clientId = match[0];
  }

  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }

  console.error('❌ Missing OAuth client: create oauth-client.json (see oauth-client.example.json) or set GOOGLE_OAUTH_CLIENT_ID/SECRET.');
  return { clientId: '', clientSecret: '' };
}

export const CONFIG = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 8045,
  HOST: '127.0.0.1',
  get CLIENT_ID() {
    return loadOAuthClient().clientId;
  },
  get CLIENT_SECRET() {
    return loadOAuthClient().clientSecret;
  },
  TOKEN_ENDPOINT: 'https://oauth2.googleapis.com/token',
  UPSTREAM_BASE_URL: 'https://generativelanguage.googleapis.com',
  ACCOUNTS_FILE: path.resolve(__dirname, '../accounts.json'),
  OAUTH_REDIRECT_URI: 'http://localhost:8085/oauth/callback',
  // Same scopes Antigravity itself signs in with; the OAuth client rejects anything else
  // (e.g. generative-language gives "Error 403: restricted_client").
  SCOPES: [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cloud-platform'
  ]
};
