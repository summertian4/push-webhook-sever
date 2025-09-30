import express from 'express';
import session from 'express-session';
import crypto from 'crypto';
import https from 'https';
import querystring from 'querystring';
import { v4 as uuidv4 } from 'uuid';
import config from './config.js';
import { readJson, writeJson, ensureDirForFile } from './lib/store.js';
import { verifyAdminLogin, changeAdminPassword, hasAdminFile, ensureAdminCredentials } from './lib/auth.js';
import { ensureBasePath } from './lib/meta.js';

const app = express();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false
}));

// Data persistence
ensureDirForFile(config.dataFile);
let db = readJson(config.dataFile, { webhooks: [] });

function saveDB() {
  writeJson(config.dataFile, db);
}

// Admin bootstrap & secret base path
const bootstrapAdmin = ensureAdminCredentials();
const basePathInfo = ensureBasePath();
const adminBaseRoute = `/${basePathInfo.basePath}`;
const withBase = (subPath = '') => `${adminBaseRoute}${subPath}`;
const routes = {
  base: adminBaseRoute,
  login: withBase('/login'),
  logout: withBase('/logout'),
  admin: withBase('/admin'),
  password: withBase('/admin/password'),
  webhooks: withBase('/admin/webhooks'),
  webhookDelete: (id) => withBase(`/admin/webhooks/${id}/delete`)
};

// Helpers
function isAuthed(req) {
  return req.session && req.session.auth === true;
}

function requireLogin(req, res, next) {
  if (!isAuthed(req)) return res.redirect(routes.login);
  next();
}

function renderPage(title, bodyHtml, opts = {}) {
  const { showNav = true } = opts;
  const headerHtml = showNav
    ? `<header class="bg-white/90 border-b border-slate-200 backdrop-blur">
        <div class="container mx-auto px-4 py-4 flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <span class="text-base font-semibold tracking-tight text-slate-900">Push Webhook 控制台</span>
            <span class="text-xs uppercase tracking-wider text-slate-400">${title}</span>
          </div>
          <nav class="flex items-center gap-2 text-sm font-medium text-slate-600">
            <a class="px-3 py-2 rounded-lg hover:bg-slate-100 hover:text-slate-900 transition" href="${routes.admin}">管理面板</a>
            <a class="px-3 py-2 rounded-lg hover:bg-slate-100 hover:text-slate-900 transition" href="${routes.password}">修改密码</a>
            <a class="px-3 py-2 rounded-lg text-rose-500 hover:bg-rose-50 transition" href="${routes.logout}">退出</a>
          </nav>
        </div>
      </header>`
    : '';

  return `<!doctype html>
  <html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="bg-slate-100 text-slate-800 min-h-screen">
    <div class="min-h-screen flex flex-col">
      ${headerHtml}
      <main class="flex-1 container mx-auto px-4 py-10">${bodyHtml}</main>
      <footer class="bg-slate-900 text-slate-400 text-xs">
        <div class="container mx-auto px-4 py-4 flex items-center justify-between">
          <span>Push Webhook Server</span>
          <span>Tailwind UI 风格界面</span>
        </div>
      </footer>
    </div>
  </body></html>`;
}

// Routes
app.get('/', (req, res) => {
  res.status(404).send('Not Found');
});

const baseEntry = (req, res) => {
  if (isAuthed(req)) return res.redirect(routes.admin);
  res.redirect(routes.login);
};

app.get(routes.base, baseEntry);
app.get(`${routes.base}/`, baseEntry);

app.get(routes.login, (req, res) => {
  const loginHint = bootstrapAdmin.created
    ? (bootstrapAdmin.password
        ? `初始账号（请妥善保存）：<strong>${bootstrapAdmin.username}</strong> / <strong>${bootstrapAdmin.password}</strong>`
        : '请使用 config.js 中配置的管理员账号登录。')
    : '请使用已设置的管理员账号登录。';

  const hintBlock = loginHint
    ? `<div class="mt-4 rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-600 leading-relaxed">
         ${loginHint}
       </div>`
    : '';

  const html = `
    <div class="max-w-md mx-auto">
      <div class="bg-white/90 backdrop-blur shadow-xl rounded-2xl p-8 space-y-6">
        <div>
          <h1 class="text-2xl font-semibold text-slate-900">管理员登录</h1>
          <p class="text-sm text-slate-500 mt-1">请输入账号密码进入控制台</p>
        </div>
        <form class="space-y-5" method="post" action="${routes.login}">
          <div>
            <label class="block text-sm font-medium text-slate-600">用户名</label>
            <input name="username" required autocomplete="username" class="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200" placeholder="请输入用户名" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600">密码</label>
            <input name="password" type="password" required autocomplete="current-password" class="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200" placeholder="请输入密码" />
          </div>
          <button type="submit" class="w-full inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400">登录</button>
        </form>
      </div>
      ${hintBlock}
    </div>`;
  res.send(renderPage('登录', html, { showNav: false }));
});

app.post(routes.login, (req, res) => {
  const { username, password } = req.body || {};
  if (verifyAdminLogin(username, password)) {
    req.session.auth = true;
    return res.redirect(routes.admin);
  }
  const html = `
    <div class="max-w-md mx-auto">
      <div class="bg-white shadow-xl rounded-2xl p-8 space-y-5">
        <div class="space-y-2">
          <h2 class="text-xl font-semibold text-slate-900">登录失败</h2>
          <p class="text-sm text-rose-500">账号或密码错误，请重试。</p>
        </div>
        <a href="${routes.login}" class="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-indigo-400 hover:text-indigo-600">返回登录</a>
      </div>
    </div>`;
  res.status(401).send(renderPage('登录失败', html, { showNav: false }));
});

app.get(routes.logout, (req, res) => {
  req.session.destroy(() => res.redirect(routes.login));
});

// Admin dashboard
app.get(routes.admin, requireLogin, (req, res) => {
  const base = config.publicBaseUrl || '';
  const loginUrlDisplay = base ? base.replace(/\/$/, '') + routes.login : routes.login;
  const adminUrlDisplay = base ? base.replace(/\/$/, '') + routes.admin : routes.admin;
  const rows = db.webhooks.map(w => {
    const path = `/hook/${w.id}/${w.token}`;
    const url = base ? base.replace(/\/$/, '') + path : path;
    const messagePreview = w.message?.length > 80 ? `${w.message.slice(0, 77)}…` : (w.message || '');
    const providers = Array.isArray(w.providers) && w.providers.length
      ? w.providers
      : [w.provider || 'pushover'];
    return `<tr>
      <td class="px-4 py-3 text-sm font-semibold text-slate-900">${w.name || '-'}</td>
      <td class="px-4 py-3 text-xs font-mono text-indigo-600 break-all">${url}</td>
      <td class="px-4 py-3 text-xs font-medium text-slate-700">${providers.join(', ')}</td>
      <td class="px-4 py-3 text-sm text-slate-700">${w.priority}</td>
      <td class="px-4 py-3 text-xs text-slate-500 break-words">${messagePreview || '-'}</td>
      <td class="px-4 py-3 text-sm text-slate-700">${w.retry ?? '-'}</td>
      <td class="px-4 py-3 text-sm text-slate-700">${w.expire ?? '-'}</td>
      <td class="px-4 py-3 text-right">
        <form class="inline" method="post" action="${routes.webhookDelete(w.id)}" onsubmit="return confirm('确定删除该 webhook?');">
          <button class="inline-flex items-center gap-1 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-rose-600" type="submit">删除</button>
        </form>
      </td>
    </tr>`;
  }).join('');
  const tableSection = db.webhooks.length
    ? `<div class="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
         <table class="min-w-full divide-y divide-slate-200">
           <thead class="bg-slate-50">
             <tr class="text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
               <th class="px-4 py-3">名称</th>
               <th class="px-4 py-3">Webhook URL</th>
               <th class="px-4 py-3">类型</th>
               <th class="px-4 py-3">优先级</th>
               <th class="px-4 py-3">默认消息</th>
               <th class="px-4 py-3">重试(s)</th>
               <th class="px-4 py-3">过期(s)</th>
               <th class="px-4 py-3 text-right">操作</th>
             </tr>
           </thead>
           <tbody class="divide-y divide-slate-100 bg-white">${rows}</tbody>
         </table>
       </div>`
    : `<div class="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-10 text-center text-slate-500">
         <p class="text-sm">尚未创建任何 webhook，使用右侧表单即可快速创建。</p>
       </div>`;

  const html = `
    <div class="space-y-10">
      <div class="grid gap-6 md:grid-cols-2">
        <div class="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm space-y-3">
          <h3 class="text-sm font-semibold uppercase tracking-wider text-slate-500">后台入口</h3>
          <div class="space-y-2 text-sm text-slate-600">
            <p>当前入口路径：<span class="font-mono text-indigo-600">${routes.base}</span></p>
            <p>登录地址：<span class="font-mono text-indigo-600 break-all">${loginUrlDisplay}</span></p>
            <p>管理面板：<span class="font-mono text-indigo-600 break-all">${adminUrlDisplay}</span></p>
          </div>
        </div>
        <div class="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm space-y-3">
          <h3 class="text-sm font-semibold uppercase tracking-wider text-slate-500">快速提示</h3>
          <ul class="space-y-2 text-sm text-slate-600 list-disc list-inside">
            <li>请尽快在“修改密码”中替换随机生成的初始密码。</li>
            <li>复制 webhook URL 时，请包含完整的 ID 与 token。</li>
            <li>若部署到公网，请在 config.js 设置 publicBaseUrl 以展示完整外网地址。</li>
          </ul>
        </div>
      </div>

      <div class="grid gap-8 lg:grid-cols-5">
        <div class="lg:col-span-3 space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-slate-900">Webhook 列表</h2>
            <span class="text-xs font-medium text-slate-500">共 ${db.webhooks.length} 个</span>
          </div>
          ${tableSection}
        </div>
        <div class="lg:col-span-2">
          <div class="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm space-y-6">
            <div class="space-y-2">
              <h2 class="text-lg font-semibold text-slate-900">新增 Webhook</h2>
              <p class="text-sm text-slate-500">选择推送类型，配置默认参数（可在触发时覆盖）。</p>
            </div>
            <form method="post" action="${routes.webhooks}" class="space-y-5">
              <div>
                <label class="block text-sm font-medium text-slate-600">名称</label>
                <input name="name" placeholder="例如：USDE 报警" class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-600">推送类型（可多选）</label>
                <div class="mt-2 grid grid-cols-2 gap-3 text-sm">
                  <label class="inline-flex items-center gap-2">
                    <input type="checkbox" name="providers" value="pushover" id="pv_pushover" checked class="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                    <span>Pushover</span>
                  </label>
                  <label class="inline-flex items-center gap-2">
                    <input type="checkbox" name="providers" value="telegram" id="pv_telegram" class="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                    <span>Telegram</span>
                  </label>
                </div>
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <div>
                  <label class="block text-sm font-medium text-slate-600">优先级 priority</label>
                  <select name="priority" id="priority" required class="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200">
                    <option value="-2">-2 (最低)</option>
                    <option value="-1">-1 (较低)</option>
                    <option value="0" selected>0 (普通)</option>
                    <option value="1">1 (高)</option>
                    <option value="2">2 (紧急，需要 retry/expire)</option>
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-medium text-slate-600">重试 retry (秒)</label>
                  <input name="retry" id="retry" type="number" min="30" step="1" placeholder="仅 priority=2 必填" class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-slate-600">过期 expire (秒)</label>
                  <input name="expire" id="expire" type="number" min="60" step="1" placeholder="仅 priority=2 必填" class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
                </div>
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-600">默认消息 message</label>
                <textarea name="message" rows="4" placeholder="默认消息，可在触发时通过 message 参数覆盖" class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"></textarea>
              </div>
              <p class="text-xs text-slate-500">Pushover 使用 config.js 的 appToken/userKey；Telegram 使用 config.js 的 botToken/chatId。</p>
              <button type="submit" class="inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400">创建 Webhook</button>
            </form>
          </div>
        </div>
      </div>
    </div>`;
  const htmlWithScript = html + `
    <script>
      (function(){
        const pP = document.getElementById('pv_pushover');
        const fields = ['priority','retry','expire'];
        function sync(){
          const isP = !pP || pP.checked; // 只在选择了 Pushover 时显示相关字段
          fields.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const wrapper = el.closest('div');
            if (wrapper) wrapper.style.display = isP ? '' : 'none';
          });
        }
        if (pP){ pP.addEventListener('change', sync); sync(); }
      })();
    </script>`;
  res.send(renderPage('Webhook 管理', htmlWithScript));
});

app.post(routes.webhooks, requireLogin, (req, res) => {
  const { name, provider, priority, message, retry, expire } = req.body || {};
  // 解析多选 providers；兼容旧的 provider 字段
  let providers = req.body.providers;
  if (!providers || (Array.isArray(providers) && providers.length === 0)) {
    providers = provider || 'pushover';
  }
  if (!Array.isArray(providers)) providers = [providers];
  providers = providers.filter(Boolean);
  if (providers.length === 0) providers = ['pushover'];
  const id = uuidv4().slice(0, 8);
  const token = crypto.randomBytes(16).toString('hex');
  const hook = {
    id,
    token,
    name: name || '',
    providers,
    priority: Number(priority || 0),
    message: message || '',
    retry: retry ? Number(retry) : undefined,
    expire: expire ? Number(expire) : undefined
  };
  db.webhooks.push(hook);
  saveDB();
  res.redirect(routes.admin);
});

// Password change
app.get(routes.password, requireLogin, (req, res) => {
  const source = hasAdminFile() ? '已设置（data/admin.json）' : '使用默认（config.js）';
  const html = `
    <div class="max-w-2xl mx-auto">
      <div class="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm space-y-8">
        <div class="space-y-2">
          <h2 class="text-2xl font-semibold text-slate-900">修改管理员密码</h2>
          <p class="text-sm text-slate-500">更新后系统会要求重新登录，新的密码会写入 data/admin.json。</p>
          <span class="inline-flex items-center rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-600">当前凭据来源：${source}</span>
        </div>
        <form method="post" action="${routes.password}" class="space-y-5">
          <div class="grid gap-4 md:grid-cols-2">
            <div class="md:col-span-2">
              <label class="block text-sm font-medium text-slate-600">当前密码</label>
              <input name="current" type="password" required autocomplete="current-password" class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200" placeholder="请输入当前密码" />
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-600">新密码</label>
              <input name="next" type="password" required minlength="6" autocomplete="new-password" class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200" placeholder="至少 6 位" />
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-600">确认新密码</label>
              <input name="confirm" type="password" required minlength="6" autocomplete="new-password" class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200" placeholder="再次输入新密码" />
            </div>
          </div>
          <button type="submit" class="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400">更新密码</button>
        </form>
        <div class="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-600">
          更新成功后当前会话将失效，需要使用新密码重新登录。
        </div>
      </div>
    </div>`;
  res.send(renderPage('修改密码', html));
});

app.post(routes.password, requireLogin, (req, res) => {
  const { current, next, confirm } = req.body || {};
  const sendError = (message) => res.status(400).send(renderPage('修改密码失败', `
    <div class="max-w-xl mx-auto">
      <div class="rounded-2xl border border-rose-100 bg-white p-8 shadow-sm space-y-5">
        <div class="space-y-1">
          <h2 class="text-xl font-semibold text-slate-900">修改密码失败</h2>
          <p class="text-sm text-slate-500">请检查提示后重新提交。</p>
        </div>
        <div class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">${message}</div>
        <a href="${routes.password}" class="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-indigo-400 hover:text-indigo-600">返回继续修改</a>
      </div>
    </div>`));

  if (!current || !next || !confirm) {
    return sendError('请填写完整信息');
  }
  if (next !== confirm) {
    return sendError('两次输入的新密码不一致');
  }
  if (String(next).length < 6) {
    return sendError('新密码长度至少 6 位');
  }
  const result = changeAdminPassword(current, next);
  if (!result.ok) {
    return sendError(result.error);
  }
  req.session.destroy(() => {
    const successHtml = `
      <div class="max-w-xl mx-auto">
        <div class="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm space-y-5">
          <div class="space-y-1">
            <h2 class="text-xl font-semibold text-slate-900">密码已更新</h2>
            <p class="text-sm text-slate-500">密码更新成功，请使用新密码重新登录。</p>
          </div>
          <a href="${routes.login}" class="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400">前往登录</a>
        </div>
      </div>`;
    res.send(renderPage('密码已更新', successHtml));
  });
});

app.post(withBase('/admin/webhooks/:id/delete'), requireLogin, (req, res) => {
  const { id } = req.params;
  db.webhooks = db.webhooks.filter(w => w.id !== id);
  saveDB();
  res.redirect(routes.admin);
});

// Trigger endpoint
app.all('/hook/:id/:token', async (req, res) => {
  const { id, token } = req.params;
  const hook = db.webhooks.find(w => w.id === id && w.token === token);
  if (!hook) return res.status(404).json({ error: 'Not found' });

  const bodyMsg = (req.body && (req.body.message || req.body.msg)) || (req.query && (req.query.message || req.query.msg));
  const message = bodyMsg || hook.message || 'Notification';
  const priority = (req.body && req.body.priority != null) ? Number(req.body.priority) : (req.query && req.query.priority != null) ? Number(req.query.priority) : hook.priority;
  const retry = (req.body && req.body.retry != null) ? Number(req.body.retry) : (req.query && req.query.retry != null) ? Number(req.query.retry) : hook.retry;
  const expire = (req.body && req.body.expire != null) ? Number(req.body.expire) : (req.query && req.query.expire != null) ? Number(req.query.expire) : hook.expire;
  const providers = Array.isArray(hook.providers) && hook.providers.length
    ? hook.providers
    : [hook.provider || 'pushover'];

  try {
    const tasks = providers.map(async (p) => {
      if (p === 'telegram') {
        const chatId = (req.body && (req.body.chatId || req.body.chat_id)) || (req.query && (req.query.chatId || req.query.chat_id)) || (config.telegram && config.telegram.chatId);
        const r = await sendTelegram({
          botToken: config.telegram && config.telegram.botToken,
          chatId,
          message
        });
        return ['telegram', { ok: true, result: r }];
      }
      const r = await sendPushover({
        appToken: config.pushover.appToken,
        userKey: config.pushover.userKey,
        message,
        priority,
        retry,
        expire
      });
      return ['pushover', { ok: true, result: r }];
    });
    const settled = await Promise.allSettled(tasks);
    const out = {};
    let anyOk = false;
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        const [k, v] = s.value; out[k] = v; anyOk = true;
      } else {
        out.error = out.error || [];
        out.error.push(String(s.reason && s.reason.message || s.reason));
      }
    }
    res.status(anyOk ? 200 : 502).json({ ok: anyOk, results: out });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message || String(e) });
  }
});

function sendPushover({ appToken, userKey, message, priority = 0, retry, expire }) {
  return new Promise((resolve, reject) => {
    if (!appToken || !userKey) {
      return reject(new Error('Missing Pushover appToken/userKey in config.js'));
    }
    const form = {
      token: appToken,
      user: userKey,
      message,
      priority
    };
    if (Number(priority) === 2) {
      if (!retry || !expire) {
        return reject(new Error('priority=2 requires retry and expire'));
      }
      form.retry = retry;
      form.expire = expire;
    }

    const postData = querystring.stringify(form);
    const options = {
      method: 'POST',
      hostname: 'api.pushover.net',
      path: '/1/messages.json',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`Pushover error ${res.statusCode}: ${parsed.errors ? parsed.errors.join(', ') : data}`));
          }
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve({ raw: data });
          reject(new Error(`Pushover error ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function sendTelegram({ botToken, chatId, message }) {
  return new Promise((resolve, reject) => {
    if (!botToken || !chatId) {
      return reject(new Error('Missing Telegram botToken/chatId in config.js'));
    }
    const form = querystring.stringify({
      chat_id: chatId,
      text: message
    });
    const options = {
      method: 'POST',
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/sendMessage`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(form)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed.ok) return resolve(parsed);
          reject(new Error(`Telegram error ${res.statusCode}: ${data}`));
        } catch (e) {
          reject(new Error(`Telegram error ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(form);
    req.end();
  });
}

// Start server
// 使用环境变量 PORT，未设置则默认 3000。可将 PORT=0 让系统分配空闲端口。
const requestedPort = process.env.PORT !== undefined ? Number(process.env.PORT) : 3000;
const server = app.listen(requestedPort, () => {
  const actualPort = server.address().port;
  const baseHost = config.publicBaseUrl ? config.publicBaseUrl.replace(/\/$/, '') : `http://localhost:${actualPort}`;
  console.log(`Push Webhook Server listening on ${baseHost}`);

  if (bootstrapAdmin.created) {
    if (bootstrapAdmin.password) {
      console.log(`[init] Admin username: ${bootstrapAdmin.username}`);
      console.log(`[init] Admin password: ${bootstrapAdmin.password}`);
    } else if (bootstrapAdmin.fromConfig) {
      console.log('[init] Admin 凭据来自 config.js (请确保妥善保管)。');
    }
  }
  console.log(`[init] Admin login URL: ${baseHost}${routes.login}`);
  console.log(`[init] Admin panel URL: ${baseHost}${routes.admin}`);
});
