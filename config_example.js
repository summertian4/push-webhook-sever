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
  dataFile: "data/webhooks.json",
  publicBaseUrl: ""
};
