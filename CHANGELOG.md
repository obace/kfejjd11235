# 版本更新日志 (Changelog)

本文档记录大姨子面板 (Dayizi Panel) 的版本演进历史、新增功能、架构改进及 Bug 修复。

---

## 🚀 v4.4.0 (2026-11)

### ✨ 新功能与重构
- **探针监控升级 (全网网速统计)**：
  - 探针页面 (`/monitor`) 顶部新增控制台级紧凑全网状态横栏。
  - 毫秒级汇总全网实时下行带宽、实时上行带宽，累计总吞吐接入 `requestAnimationFrame` 平滑插值跳动动效。
  - 支持手机与电脑端自适应弹性布局，单节点详情图表联动自动收起。
- **全新互动娱乐系统上线**：
  - **农场小游戏 (`/farm-game`)**：以月华宝莲为主题，支持播种、定时浇水、签到领种、成熟收割兑换流量奖励及拜访好友偷菜互动。
  - **月度求签 (`/fortune`)**：每月开放 1 次求签特权，依据剩余流量池翻倍或赠送（上上签 +100%、上吉签 +50%、中吉签 +25%、小吉签 +10%），支持 Web 端与 Telegram Bot 双端同步。
  - **旧版代码彻底清理**：全面下线并移除历史遗留的大转盘 (`lucky-wheel`)、每日翻卡 (`flip`) 与猜拳对决 (`rps`) 废弃文件与路由。
- **Telegram Bot 稳定性加固**：
  - 新增 `/fortune` 快捷指令及 WebApp 唤起按钮。
  - 根除 Watchdog 引起的多重并发轮询问题，彻底解决 Telegram 409 Conflict 异常。
  - 流量告警与农场成熟通知接入数据库持久化防重与并发锁，杜绝进程重启时消息重复推送。
- **UI/UX 全面优化**：
  - 面板导航交互与农场按钮色彩全面重构，统一为深色半透明毛玻璃（Glassmorphism）与夜幕月华色系。

---

## ⚡ v4.3.0 (2026-06)

### ✨ 新功能
- **反代型容器节点支持 (VLESS + WS + TLS)**：
  - 节点管理模块新增「手动添加节点」表单，支持配置 `ws` / `grpc` 传输、`tls` 安全校验以及自定义 `path` / SNI。
  - 完美接入通过前置平台（如 Northflank / Nginx / Caddy）做 TLS 终止后反代至明文 WS 端口的容器型节点。
  - 订阅生成模块（V2Ray Base64 / Clash YAML / Sing-box JSON）全协议支持 WS·gRPC + TLS 语法。
- **节点用户同步 API**：
  - 新增 `GET /api/agent/users` 接口（使用 Bearer `agent_token` 鉴权），实时返回本节点有效用户列表 `[{userId, uuid, username}]`，支持自研协议核心按 UUID 鉴权与按 `userId` 统计流量。
- **轻量级自研容器 Core (`container-core/`)**：
  - 提供 Go 语言实现的纯净 VLESS-over-WS 入站核心，原生支持按用户流量计量。
  - 复用面板已有 `/ws/agent` WebSocket 通信协议进行心跳与增量流量上报，无需依赖重量级 Xray 内核。

### 🔧 改进与优化
- **心跳存活字段兼容**：`/ws/agent` 协议支持将 `serviceAlive` 作为 `xrayAlive` 的别名，便于非 Xray 自研节点服务上报存活状态。
- **Clash YAML 导出生成**：修复深层嵌套属性（如 `ws-opts.headers.Host`）在序列化时被误处理为 `[object Object]` 的缺陷。

---

## ⚡ v4.2.0 (2026-05)

### ✨ 新功能
- **TG 账号自助解绑**：用户可在面板首页顶部导航栏一键解绑关联的 Telegram 账号。
- **TG 未签到自动冻结**：支持针对 30 天未在 TG 签到的绑定用户实施自动冻结，签到后自动恢复解冻状态。
- **探针监控全员开放**：探针监控页面（`/monitor`）从管理员专属调整为所有已登录用户均可实时查看。

### 🐛 Bug 修复
- **修复 AWS 换 IP 异常**：解决 `notify.ops()` 在通知开关关闭时返回 `undefined` 引发 `TypeError` 导致的 500 报错（实际 IP 已成功更替）。
- **修复外键数据剔除异常**：代理节点上传已删除节点/用户的旧流量时，优化为记录 debug 日志，消除外键约束崩溃风险。
- **密码哈希 DoS 防护**：对 `scrypt` 计算参数限制算法边界（$N \le 2^{20}, r \le 16, p \le 4$），防范恶意哈希引起的 CPU/内存 DoS 攻击。

### 🌍 AWS 区域拓展
- **亚太地区**：新增 `ap-southeast-3`（雅加达）、`ap-southeast-4`（墨尔本）、`ap-southeast-5`（吉隆坡）、`ap-southeast-7`（曼谷）、`ap-south-2`（海得拉巴）。
- **美洲地区**：新增 `ca-west-1`（加拿大西部）、`mx-central-1`（墨西哥）。
- **欧洲地区**：新增 `eu-central-2`（苏黎世）、`eu-south-1`（米兰）、`eu-south-2`（西班牙）。
- **中东及非洲**：新增 `me-central-1`（阿联酋）、`il-central-1`（以色列）、`af-south-1`（开普敦）。

---

## 🛠️ v4.1.1 (2026-03-17)

### 🐛 Bug 修复
- 修复用户注册与登录阶段密码 `.trim()` 逻辑不一致导致含首尾空格密码无法正常登录的问题。
- 修复 `emitSyncNode` 向长连接推流时误传更新前旧节点对象的问题。
- 修复编辑 AWS 账号参数时，SOCKS5 落地代理配置被意外置空的缺陷。
- 修复 SS 节点部署缺少 `ssh_key_path` 导致基于 SSH Key 认证的远程节点部署后无法回连的问题。

### 🧹 代码整理与架构演进
- 抽离 `src/utils/regions.js` 统一处理全球物理区域与国旗 Emoji 映射。
- 抽离 `src/utils/tgGame.js` 统一封装 Telegram WebApp 游戏公共逻辑。
- 拆分 `src/services/migrations.js` 专门负责 SQLite 数据库版本迁移与 Schema 演进。

---

## 📌 v4.0.0 (2026-03-10)

- 重构架构，将邮箱注册验证、找回密码、订阅 HMAC 签名防盗链及 Telegram Bot 系统全面深度融合。
