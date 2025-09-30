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

function renderPage(title, bodyHtml) {
  return `<!doctype html>
  <html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body{font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, PingFang SC, Noto Sans, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem;}
      header{display:flex; justify-content: space-between; align-items:center; margin-bottom: 1rem;}
      table{border-collapse:collapse; width:100%;}
      th,td{border:1px solid #ddd; padding:8px;}
      th{background:#f7f7f7;}
      input, select, textarea { padding: 6px 8px; font-size: 14px; }
      form.inline { display:inline; }
      .muted{color:#777}
      .danger{color:#b00020}
      .code{font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;}
      .row{display:flex; gap:8px; flex-wrap:wrap;}
      .row > * { flex: 1 1 auto; min-width: 180px; }
      .btn{ padding:6px 10px; cursor:pointer; }
    </style>
  </head>
  <body>
  <header>
    <h2>${title}</h2>
    <nav>
      <a href="${routes.admin}">管理</a>
      <a href="${routes.password}">修改密码</a>
      <a href="${routes.logout}">退出</a>
    </nav>
  </header>
  ${bodyHtml}
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

  const html = `
    <h3>管理员登录</h3>
    <form method="post" action="${routes.login}">
      <div class="row">
        <label>用户名<br><input name="username" required></label>
        <label>密码<br><input name="password" type="password" required></label>
      </div>
      <p><button class="btn" type="submit">登录</button></p>
      <p class="muted">${loginHint}</p>
    </form>`;
  res.send(renderPage('登录', html));
});

app.post(routes.login, (req, res) => {
  const { username, password } = req.body || {};
  if (verifyAdminLogin(username, password)) {
    req.session.auth = true;
    return res.redirect(routes.admin);
  }
  res.status(401).send(renderPage('登录失败', `<p class="danger">账号或密码错误</p><p><a href="${routes.login}">返回登录</a></p>`));
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
    return `<tr>
      <td>${w.name || ''}</td>
      <td class="code">${url}</td>
      <td>${w.priority}</td>
      <td class="code">${w.message?.length > 80 ? (w.message.slice(0, 77) + '...') : (w.message || '')}</td>
      <td>${w.retry || ''}</td>
      <td>${w.expire || ''}</td>
      <td>
        <form class="inline" method="post" action="${routes.webhookDelete(w.id)}" onsubmit="return confirm('确定删除该 webhook?');">
          <button class="btn danger" type="submit">删除</button>
        </form>
      </td>
    </tr>`;
  }).join('');

  const html = `
    <section>
      <p class="muted">当前后台入口路径：<span class="code">${routes.base}</span></p>
      <p class="muted">登录地址：<span class="code">${loginUrlDisplay}</span></p>
      <p class="muted">管理面板：<span class="code">${adminUrlDisplay}</span></p>
    </section>
    <section>
      <h3>Webhook 列表</h3>
      <table>
        <thead><tr><th>名称</th><th>URL</th><th>优先级</th><th>消息</th><th>重试(s)</th><th>过期(s)</th><th>操作</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="muted">暂无</td></tr>'}</tbody>
      </table>
    </section>
    <section>
      <p><a href="${routes.password}">修改管理员密码</a></p>
      <h3 style="margin-top:1.5rem">新增 Webhook</h3>
      <form method="post" action="${routes.webhooks}">
        <div class="row">
          <label>名称<br><input name="name" placeholder="例如：USDE 报警"></label>
          <label>优先级 priority<br>
            <select name="priority" required>
              <option value="-2">-2 (最低)</option>
              <option value="-1">-1 (较低)</option>
              <option value="0" selected>0 (普通)</option>
              <option value="1">1 (高)</option>
              <option value="2">2 (紧急，需 retry/expire)</option>
            </select>
          </label>
          <label>重试(秒) retry<br><input name="retry" type="number" min="30" step="1" placeholder="仅 priority=2 需要"></label>
          <label>过期(秒) expire<br><input name="expire" type="number" min="60" step="1" placeholder="仅 priority=2 需要"></label>
        </div>
        <label>消息内容 message<br>
          <textarea name="message" rows="3" placeholder="默认消息，可在触发时用 message 覆盖"></textarea>
        </label>
        <p class="muted">Pushover 将使用 config.js 中的 appToken 和 userKey 发送。</p>
        <p><button class="btn" type="submit">添加</button></p>
      </form>
    </section>`;
  res.send(renderPage('Webhook 管理', html));
});

app.post(routes.webhooks, requireLogin, (req, res) => {
  const { name, priority, message, retry, expire } = req.body || {};
  const id = uuidv4().slice(0, 8);
  const token = crypto.randomBytes(16).toString('hex');
  const hook = {
    id,
    token,
    name: name || '',
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
    <section>
      <h3>修改管理员密码</h3>
      <p class="muted">当前凭据来源：${source}</p>
      <form method="post" action="${routes.password}">
        <div class="row">
          <label>当前密码<br><input name="current" type="password" required></label>
          <label>新密码<br><input name="next" type="password" required minlength="6"></label>
          <label>确认新密码<br><input name="confirm" type="password" required minlength="6"></label>
        </div>
        <p><button class="btn" type="submit">更新密码</button></p>
      </form>
      <p class="muted">提示：更新成功后将需要重新登录。</p>
    </section>`;
  res.send(renderPage('修改密码', html));
});

app.post(routes.password, requireLogin, (req, res) => {
  const { current, next, confirm } = req.body || {};
  if (!current || !next || !confirm) {
    return res.status(400).send(renderPage('修改密码', `<p class="danger">请填写完整信息</p><p><a href="${routes.password}">返回</a></p>`));
  }
  if (next !== confirm) {
    return res.status(400).send(renderPage('修改密码', `<p class="danger">两次输入的新密码不一致</p><p><a href="${routes.password}">返回</a></p>`));
  }
  if (String(next).length < 6) {
    return res.status(400).send(renderPage('修改密码', `<p class="danger">新密码长度至少 6 位</p><p><a href="${routes.password}">返回</a></p>`));
  }
  const result = changeAdminPassword(current, next);
  if (!result.ok) {
    return res.status(400).send(renderPage('修改密码', `<p class="danger">${result.error}</p><p><a href="${routes.password}">返回</a></p>`));
  }
  req.session.destroy(() => {
    res.send(renderPage('密码已更新', `<p>密码已更新，请重新登录。</p><p><a href="${routes.login}">前往登录</a></p>`));
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

  try {
    const result = await sendPushover({
      appToken: config.pushover.appToken,
      userKey: config.pushover.userKey,
      message,
      priority,
      retry,
      expire
    });
    res.json({ ok: true, pushover: result });
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
