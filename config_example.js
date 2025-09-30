// 复制此文件为 config.js 并填入真实配置
export default {
  sessionSecret: "change-this-session-secret",
  admin: {
    username: "admin",
    password: "please-change-me",
    basePath: "" // 可自定义后台路径；留空则随机生成
  },
  pushover: {
    appToken: "YOUR_PUSHOVER_APP_TOKEN",
    userKey: "YOUR_PUSHOVER_USER_KEY"
  },
  // Telegram 推送（可选）：如需使用 Telegram，请在此填入
  // 你的 Bot Token 与接收方 chatId（可为个人或群聊的 ID）。
  telegram: {
    botToken: "YOUR_TELEGRAM_BOT_TOKEN",
    chatId: "YOUR_TELEGRAM_CHAT_ID"
  },
  dataFile: "data/webhooks.json",
  publicBaseUrl: ""
};
