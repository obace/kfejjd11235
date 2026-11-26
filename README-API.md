# API 接口参考

本文档列出大姨子面板 (Dayizi Panel) 当前生效的 HTTP 与 WebSocket 接口。

---

## 🔐 鉴权约定

1. **Web 会话接口**：使用 `express-session` Cookie 鉴权；所有写操作受 CSRF 保护（请求头 `X-CSRF-Token` 或表单字段 `_csrf`）。
2. **OPS 运维接口 (`/ops/api/*`)**：需携带 `.env` 中配置的 `OPS_API_KEY`，支持以下任一方式：
   - 请求头：`X-Ops-Key: <OPS_API_KEY>`
   - 请求头：`Authorization: Bearer <OPS_API_KEY>`
3. **Agent 接口 (`/api/agent/*` & `/ws/agent`)**：使用节点专属 `agent_token` 鉴权。

---

## 🏥 健康检查

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/healthz` | 面板进程与数据库存活检查，返回 HTTP 200 |

---

## 🔑 身份认证 (`/auth/*`)

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/auth/login` | 登录页面 |
| `POST` | `/auth/email-login` | 邮箱密码登录 |
| `GET` / `POST` | `/auth/email-register` | 邮箱注册页面与提交 |
| `POST` | `/auth/send-email-code` | 发送注册邮箱验证码 |
| `GET` | `/auth/forgot-password` | 找回密码页面 |
| `POST` | `/auth/forgot-send-code` | 发送重置密码验证码 |
| `POST` | `/auth/forgot-reset` | 重置密码 |
| `GET` | `/auth/nodeloc` | 跳转 NodeLoc OAuth 登录 |
| `GET` | `/auth/nodeloc/callback` | NodeLoc OAuth 回调（兼容 `/auth/callback`） |
| `GET` / `POST` | `/auth/temp-login` | 临时访问凭证登录 |
| `POST` | `/auth/generate-invite-code` | 生成个人邀请码（需登录 + CSRF） |
| `GET` | `/auth/logout` | 退出登录 |

---

## 📊 用户面板、探针与订阅

| 方法 | 路径 | 鉴权 | 说明 |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Session | 用户主页 |
| `GET` | `/monitor` | Session | 节点探针页面 |
| `GET` | `/api/panel-summary` | Session | 首页统计摘要与用户流量/状态 |
| `GET` | `/api/peach-status` | Session | 用户互动状态摘要 |
| `GET` | `/api/monitor/overview` | Session | 全网实时带宽与节点状态概览 |
| `GET` | `/api/monitor/node/:id` | Session | 单节点实时负载与历史指标 |
| `POST` | `/api/tg-bind-token` | Session + CSRF | 生成 Telegram 绑定口令 |
| `POST` | `/api/tg-unbind` | Session + CSRF | 解绑 Telegram |
| `POST` | `/api/reset-subscription` | Session + CSRF | 重置个人订阅 Token |
| `GET` | `/sub/:token` | 订阅 Token (+ HMAC 签名) | 按客户端 UA 下发订阅配置 |

---

## 🌾 农场与求签 (`/farm-game`, `/fortune`, `/farm/api/*`)

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/farm-game` | 农场游戏页面 |
| `GET` | `/fortune` | 月度求签页面 |
| `POST` | `/farm/api/state` | 获取农场状态 |
| `POST` | `/farm/api/plant` | 种植作物 |
| `POST` | `/farm/api/harvest` | 收获指定地块 |
| `POST` | `/farm/api/harvest-all` | 一键全部收获 |
| `POST` | `/farm/api/visit` | 拜访好友农场 |
| `POST` | `/farm/api/steal` | 偷取成熟作物 |
| `POST` | `/farm/api/checkin` | 每日签到 |
| `POST` | `/farm/api/fortune/state` | 查询本月求签状态 |
| `POST` | `/farm/api/fortune/draw` | 抽取本月签运 |

---

## 🤖 OPS 运维接口 (`/ops/api/*`)

均需通过 `X-Ops-Key` 或 `Bearer` 鉴权：

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/ops/api/status` | 面板运行状态、内存、数据库与在线统计 |
| `GET` | `/ops/api/health-summary` | 节点与系统健康汇总 |
| `GET` | `/ops/api/nodes` | 节点列表与状态 |
| `GET` | `/ops/api/nodes/:id` | 单个节点详情 |
| `POST` | `/ops/api/nodes/:id/restart-xray` | 重启节点代理服务 |
| `POST` | `/ops/api/nodes/:id/swap-ip` | 触发关联云主机更换公网 IP |
| `POST` | `/ops/api/nodes/:id/sync-config` | 下发并同步节点配置 |
| `POST` | `/ops/api/deploy` | 触发远程节点部署 |
| `POST` | `/ops/api/rotate` | 执行节点端口/凭据轮换 |
| `GET` | `/ops/api/users` | 用户列表与用量 |
| `POST` | `/ops/api/users/:id/freeze` | 冻结用户 |
| `POST` | `/ops/api/users/:id/unfreeze` | 解冻用户 |
| `GET` | `/ops/api/audit-log` | 运维审计日志 |
| `POST` | `/ops/api/backup` | 立即触发数据库备份 |
| `GET` | `/ops/api/agents` | 在线 Agent 版本与连接列表 |
| `POST` | `/ops/api/agents/update-all` | 批量推送 Agent 更新 |
| `GET` | `/ops/api/security/multi-node-overview` | 多节点并发异常用户概览 |
| `GET` | `/ops/api/probe/targets` | 获取需由国内探测机检测的节点目标列表 |
| `POST` | `/ops/api/probe/report` | 接收国内探测机上报的连通性结果 |

---

## 📡 节点与 Agent 接口

| 协议 / 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/api/agent/download` | 下载最新版 `node-agent` 脚本 |
| `GET` | `/api/agent/users` | 节点同步当前有效用户与 UUID/凭据表 |
| `WebSocket` | `/ws/agent` | Agent 长连接通道：心跳、资源监控、实时在线人数与增量流量上报，以及面板下发指令 |
