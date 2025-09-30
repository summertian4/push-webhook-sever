import fs from 'fs';
import crypto from 'crypto';
import config from '../config.js';
import { ensureDirForFile, readJson, writeJson } from './store.js';
import { randomString } from './utils.js';

const ADMIN_FILE = 'data/admin.json';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const key = crypto.scryptSync(password, salt, 64); // 64 bytes key
  return { algo: 'scrypt', salt, hash: key.toString('hex') };
}

function verifyPassword(password, record) {
  if (!record || record.algo !== 'scrypt') return false;
  try {
    const key = crypto.scryptSync(password, record.salt, 64);
    return crypto.timingSafeEqual(Buffer.from(record.hash, 'hex'), key);
  } catch {
    return false;
  }
}

export function loadAdminRecord() {
  if (!fs.existsSync(ADMIN_FILE)) return null;
  const data = readJson(ADMIN_FILE, null);
  if (!data || !data.username || !data.password) return null;
  return data; // { username, password: { algo, salt, hash } }
}

export function hasAdminFile() {
  return fs.existsSync(ADMIN_FILE);
}

export function verifyAdminLogin(username, password) {
  const stored = loadAdminRecord();
  if (stored) {
    if (username !== stored.username) return false;
    return verifyPassword(password, stored.password);
  }
  // Fallback to config.js default
  return username === config.admin.username && password === config.admin.password;
}

export function changeAdminPassword(currentPassword, newPassword) {
  // Validate current
  const stored = loadAdminRecord();
  let username;
  if (stored) {
    username = stored.username;
    if (!verifyPassword(currentPassword, stored.password)) {
      return { ok: false, error: '当前密码不正确' };
    }
  } else {
    username = config.admin.username;
    if (!(currentPassword === config.admin.password)) {
      return { ok: false, error: '当前密码不正确' };
    }
  }

  const password = hashPassword(newPassword);
  const record = { username, password };
  ensureDirForFile(ADMIN_FILE);
  writeJson(ADMIN_FILE, record);
  return { ok: true };
}

export function ensureAdminCredentials() {
  const stored = loadAdminRecord();
  if (stored) {
    return { username: stored.username, created: false };
  }

  const configUser = config?.admin?.username;
  const configPass = config?.admin?.password;
  const useConfig = Boolean(configUser && configPass && (configUser !== 'admin' || configPass !== 'pass-4U8Yb2Qj'));

  const username = useConfig ? configUser : `u_${randomString(10)}`;
  const generatedPassword = useConfig ? configPass : `p_${randomString(14)}`;

  const password = hashPassword(generatedPassword);
  const record = { username, password };
  ensureDirForFile(ADMIN_FILE);
  writeJson(ADMIN_FILE, record);
  return {
    username,
    password: useConfig ? undefined : generatedPassword,
    created: true,
    fromConfig: useConfig
  };
}
