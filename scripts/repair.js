import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, execSync } from 'child_process';
import os from 'os';
import http from 'http';
import {
  detectAntigravityInstall,
  extractOAuthCredentials,
  ensureOAuthConfigFile,
  importCurrentAntigravityAccount,
  createDesktopShortcuts,
  log
} from './setup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

async function checkPortStatus(port = 8045) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/stats`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ online: true, statusCode: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ online: true, statusCode: res.statusCode, data: null });
        }
      });
    });
    req.on('error', () => resolve({ online: false }));
    req.on('timeout', () => { req.destroy(); resolve({ online: false }); });
  });
}

function killProcessOnPort(port = 8045) {
  if (process.platform === 'win32') {
    try {
      const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8' });
      const lines = out.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && !isNaN(pid) && pid !== '0') {
          try {
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
            log(`Stopped old Gateway process (PID: ${pid})`, 'info');
          } catch {}
        }
      }
    } catch {}
  } else {
    try {
      execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: 'ignore' });
    } catch {}
  }
}

export async function runRepair() {
  console.log('\n======================================================');
  console.log('   🛠️  Antigravity Gateway - Auto-Repair & Diagnostic  ');
  console.log('======================================================\n');

  log(`Checking environment: ${os.type()} ${os.release()} (${os.arch()})`, 'info');

  // 1. Detect Antigravity Installation
  log('Step 1: Inspecting Antigravity installation...', 'info');
  const install = detectAntigravityInstall();
  if (!install || !install.exists) {
    log('Antigravity installation not found in standard paths!', 'error');
    log('Please ensure Antigravity is installed.', 'warn');
  } else {
    log(`Antigravity installation verified at: ${install.root}`, 'success');
    if (install.hasLs) {
      log(`Language Server binary found: ${install.ls}`, 'success');
      
      // Step 2: Re-extract OAuth credentials in case binary changed
      log('Step 2: Checking for updated OAuth credentials in binary...', 'info');
      const extracted = await extractOAuthCredentials(install.ls);
      if (extracted) {
        const oauthFile = path.join(ROOT_DIR, 'oauth-client.json');
        fs.writeFileSync(oauthFile, JSON.stringify({
          client_id: extracted.clientId,
          client_secret: extracted.clientSecret
        }, null, 2), 'utf8');
        log(`Synced OAuth credentials: ${extracted.clientId}`, 'success');
      }
    } else {
      log(`Language Server binary not found at ${install.ls}!`, 'warn');
    }
  }

  // 3. Inspect Windows Credential Store
  if (process.platform === 'win32') {
    log('Step 3: Checking Windows Credential Store ("gemini:antigravity")...', 'info');
    const psScript = path.join(ROOT_DIR, 'scripts', 'wincred.ps1');
    try {
      const cred = execFileSync('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', psScript,
        '-Action', 'read',
        '-Target', 'gemini:antigravity'
      ], { encoding: 'utf8', timeout: 5000 }).trim();

      if (cred && cred.length > 20) {
        log('Windows Credential Store contains active Antigravity session.', 'success');
        importCurrentAntigravityAccount();
      } else {
        log('No active credential found in "gemini:antigravity". You may need to log in to Antigravity.', 'warn');
      }
    } catch (err) {
      log(`Credential check warning: ${err.message}`, 'warn');
    }
  }

  // 4. Clean up shortcuts
  log('Step 4: Updating desktop launcher shortcuts...', 'info');
  createDesktopShortcuts();

  // 5. Restart Gateway service cleanly
  log('Step 5: Restarting Antigravity Gateway background service...', 'info');
  killProcessOnPort(8045);

  // Short pause
  await new Promise(r => setTimeout(r, 1000));

  if (process.platform === 'win32') {
    const vbs = path.join(ROOT_DIR, 'run-background.vbs');
    execSync(`wscript.exe "${vbs}"`, { stdio: 'ignore' });
  } else {
    execSync('npm start &', { stdio: 'ignore', cwd: ROOT_DIR });
  }

  // Wait and verify service health
  log('Verifying Gateway health...', 'info');
  let health = null;
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 1000));
    health = await checkPortStatus(8045);
    if (health.online) break;
  }

  console.log('\n======================================================');
  if (health && health.online) {
    log('Repair completed successfully! Gateway is alive and responsive.', 'success');
    log(`Web UI available at: http://127.0.0.1:8045`, 'info');
    if (health.data) {
      const accCount = Object.keys(health.data.accounts || {}).length;
      log(`Active accounts registered: ${accCount}`, 'info');
      log(`Antigravity process status: ${health.data.antigravity?.running ? 'RUNNING' : 'STOPPED'}`, 'info');
    }
  } else {
    log('Gateway did not respond on port 8045 within timeout.', 'warn');
    log('Try running "start.bat" -> option [2] to see live error logs.', 'info');
  }
  console.log('======================================================\n');
}

if (process.argv[1] && process.argv[1].endsWith('repair.js')) {
  runRepair().catch(err => {
    console.error('Repair failed:', err);
    process.exit(1);
  });
}
