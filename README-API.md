# API 规范与接口参考

本文档提供大姨子面板 (Dayizi Panel) 的全量 RESTful API 规范、鉴权机制及调试示例。

---

## 🔐 鉴权机制与统一约定

1. **用户会话 (`requireAuth`)**：标准 Express Session Cookie 认证，适用于用户面板页面。
2. **管理后台 API (`/admin/api/*`)**：需要管理员 Session + CSRF Header 防护。
3. **互动与 WebApp API (`/farm/api/*`)**：支持 Web Session 登录鉴权或 Telegram WebApp `initData` 签名校验。
4. **Agent 节点同步 API (`/api/agent/*`)**：需要请求头携带 `Authorization: Bearer <agent_token>`。
5. **OPS 运维 API (`/ops/api/*`)**：需要请求头携带 `Authorization: Bearer <OPS_API_KEY>`，供外部自动化或 AI 巡检系统调用。
6. **统一响应结构**：
   - **成功**：`{ "ok": true, "data": ... }` 或包含请求的具体数据对象。
   - **错误**：`{ "error": "错误说明信息" }` 或 `{ "ok": false, "error": "错误说明信息" }`。

---

## 🏥 基础服务与健康检查

```http
GET /healthz
```
- **鉴权要求**：无（公开）
- **响应示例**：
  ```json
  {
    "status": "ok",
    "timestamp": "2026-11-21T20:00:00.000Z"
  }
  ```

---

## 🔑 身份认证 API (`/auth/*`)

| 请求方法 | 路由路径 | 说明 | 鉴权要求 |
|---|---|---|---|
| `GET` | `/auth/login` | 获取登录页面 | 公开 |
| `POST` | `/auth/email-login` | 邮箱与密码登录 | 公开 |
| `GET` | `/auth/email-register` | 获取注册页面 | 公开 |
| `POST` | `/auth/email-register` | 邮箱注册提交 | 公开（需要邮箱验证码） |
| `POST` | `/auth/send-email-code` | 发送邮箱注册验证码 | 限流 |
| `GET` | `/auth/forgot-password` | 获取找回密码页面 | 公开 |
| `POST` | `/auth/forgot-send-code` | 发送重置密码验证码 | 限流 |
| `POST` | `/auth/forgot-reset` | 提交新密码重置 | 验证码校验 |
| `GET` | `/auth/temp-login` | 临时 Token 登录页面 | Token 校验 |
| `POST` | `/auth/generate-invite-code` | 生成邀请码 | 已登录用户 |
| `GET` | `/auth/logout` | 退出当前登录会话 | 已登录用户 |

---

## 📊 用户面板与探针 API

| 请求方法 | 路由路径 | 说明 | 鉴权要求 |
|---|---|---|---|
| `GET` | `/` | 用户面板首页 | 用户登录 |
| `GET` | `/api/panel-summary` | 获取配额、已用流量、节点及订阅状态 | 用户登录 |
| `POST` | `/api/tg-bind-token` | 生成 Telegram 绑定 Token | 用户登录 |
| `POST` | `/api/tg-unbind` | 解绑已关联的 Telegram 账号 | 用户登录 |
| `GET` | `/monitor` | 探针监控页面（含全网实时带宽横栏） | 用户登录 |
| `GET` | `/api/monitor/overview` | 获取所有节点 CPU/内存/磁盘/实时网速及累计流量 | 用户登录 |
| `GET` | `/api/monitor/node/:id` | 查询指定节点历史性能指标曲线（1h/6h/24h/7d） | 用户登录 |

---

## 📡 订阅分发 API

| 路由路径 | 协议与用途 |
|---|---|
| `GET /sub/:token` | VLESS 格式订阅 |
| `GET /sub6/:token` | VLESS (纯 IPv6) 格式订阅 |
| `GET /subhy2/:token` | Hysteria 2 格式订阅 |
| `GET /suball/:token` | 全协议混合订阅 |

- **智能 UA 转换**：自动检测 `User-Agent`，为 Clash 返回 YAML 配置，为 Sing-box 返回 JSON 配置，为通用客户端返回 Base64 文本。
- **签名校验**：当 `.env` 中配置 `SUB_LINK_SIGN_MODE=enforce` 时，请求必须携带有效的 `?sig=...` 签名参数。

---

## 🌾 农场游戏与求签 API (`/farm/api/*`)

用户与 Telegram 绑定的游戏娱乐接口，支持 Web 端登录及 Telegram WebApp 打开。

| 请求方法 | 路由路径 | 功能说明 | 鉴权要求 |
|---|---|---|---|
| `GET` | `/farm-game` | 农场小游戏页面 | 用户登录 / WebApp |
| `POST` | `/farm/api/state` | 获取农场当前土地、作物阶段、水分与种子信息 | 用户登录 / WebApp |
| `POST` | `/farm/api/plant` | 播种月华宝莲 | 用户登录 / WebApp |
| `POST` | `/farm/api/water` | 浇水（缩短成熟周期） | 用户登录 / WebApp |
| `POST` | `/farm/api/harvest` | 收获成熟作物（增加可用流量） | 用户登录 / WebApp |
| `POST` | `/farm/api/checkin` | 农场签到领取种子 | 用户登录 / WebApp |
| `POST` | `/farm/api/visit` | 拜访好友农场与互动 | 用户登录 / WebApp |
| `GET` | `/fortune` | 独立求签页面 | 用户登录 / WebApp |
| `POST` | `/farm/api/fortune/state` | 获取本月求签状态与资格 | 用户登录 / WebApp |
| `POST` | `/farm/api/fortune/draw` | 执行求签（每月 1 次，按剩余流量比例倍增） | 需绑定 TG |

---

## 🤖 OPS 运维 API (`/ops/api/*`)

请求头需携带 `Authorization: Bearer <OPS_API_KEY>`。

### 1. 数据查询接口
- `GET /ops/api/status`：获取系统综合运行健康度。
- `GET /ops/api/nodes`：获取全部节点状态、通信延迟与连通性。
- `GET /ops/api/users`：获取系统用户数、在线状态与流量消耗排行。

### 2. 自动化操作接口
- `POST /ops/api/node/rotate-ip`：触发指定 AWS 节点的 IP 更换流程。
- `POST /ops/api/node/restart-service`：远程重启节点服务进程。
- `POST /ops/api/backup/create`：立即触发一次数据库安全备份。

---

## 📡 节点与 Agent API

| 请求方法 | 路由路径 | 功能说明 | 鉴权要求 |
|---|---|---|---|
| `GET` | `/api/agent/users` | 同步当前节点的有效用户 UUID 表 | Bearer `agent_token` |
| `GET` | `/ws/agent` | WebSocket 双向长连接，用于状态心跳与增量流量上报 | Query `token` + `nodeId` |
