import config from '../config.js';
import { ensureDirForFile, readJson, writeJson } from './store.js';
import { randomString } from './utils.js';

const META_FILE = 'data/server-meta.json';
const BASE_PATH_REG = /^[A-Za-z0-9_-]+$/;

function sanitizeBasePath(input) {
  if (!input) return null;
  const trimmed = String(input).replace(/^\/+|\/+$/g, '');
  if (!trimmed) return null;
  if (!BASE_PATH_REG.test(trimmed)) return null;
  return trimmed;
}

export function ensureBasePath() {
  const existing = readJson(META_FILE, null);
  if (existing && sanitizeBasePath(existing.basePath)) {
    return { basePath: sanitizeBasePath(existing.basePath), created: false, fromConfig: false };
  }

  const configBase = sanitizeBasePath(config?.admin?.basePath);
  const fromConfig = Boolean(configBase);
  const basePath = configBase || `panel_${randomString(18)}`;

  const meta = {
    basePath,
    createdAt: new Date().toISOString(),
    fromConfig
  };
  ensureDirForFile(META_FILE);
  writeJson(META_FILE, meta);
  return { basePath, created: true, fromConfig };
}

export function getMetaFilePath() {
  return META_FILE;
}

