# 大姨子的诱惑 (Dayizi Panel)

> 面向个人与小型团队的多协议代理节点管理与订阅分发面板。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5-lightgrey.svg)](https://expressjs.com)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-blue)](https://www.sqlite.org)

基于 **Node.js 20+ / Express 5 / SQLite (`better-sqlite3`, WAL)** 构建，集成了用户管理、多协议节点编排、智能订阅分发、实时探针监控、AWS 云平台自动化、国内单向被墙探测、Telegram Bot 互动及数据库备份恢复。

---

## ✨ 核心特性

- **多协议支持与部署**：原生支持 **VLESS Reality (TCP/WS)**、**Shadowsocks** 与 **Hysteria 2**；支持通过 SSH 自动部署节点、配置双协议与端口冲突检测，或添加手动节点。
- **智能订阅与安全防盗链**：根据客户端 UA（Clash / Sing-box / V2Ray / Shadowrocket / Quantumult X 等）自动下发对应配置；支持 HMAC 订阅签名（`off` / `observe` / `enforce`）、IP/Token 限流与多节点异常并发观察。
- **用户分组与精准流量控制**：支持用户组、流量限额、过期时间与不活跃自动冻结；零流量用户自动禁止接入节点；节点连接态与流量由 `node-agent` / `container-core` 实时上报。
- **云平台自动化 (AWS)**：支持 EC2 / Lightsail 实例巡检、自动绑定（1 对 1 主节点去重）、定时自动换 IP（含冷却保护）、解绑/删除清理及多区域并发拉取。
- **国内单向阻断探测**：支持配合国内探测机（如华为云上海 `templates/huawei-cn-probe.js`）定期对所有海外节点发起 TCP/TLS 连通性检测并上报至 `/ops/api/probe/report`，精准识别单向被墙并触发告警或换 IP。
- **实时探针与交互**：用户端提供节点探针（`/monitor`）与全网实时网速/在线统计；内置农场种植（`/farm-game`）、月度求签（`/fortune`）及 Telegram Bot 签到与告警通知。
- **运维与备份**：内置数据库自动备份、加密导出/恢复与 OPS API，支持自动化脚本或外部监控接入。

---

## 🚀 快速部署

### 1. 一键脚本部署（Debian 11+ / Ubuntu 20.04+）

```bash
bash <(curl -sL https://raw.githubusercontent.com/obace/kfejjd11235/main/install.sh)
```

### 2. 手动部署

```bash
git clone https://github.com/obace/kfejjd11235.git /root/panel
cd /root/panel
npm ci --omit=dev
cp .env.example .env
# 编辑 .env，至少配置 PANEL_DOMAIN、PORT、SESSION_SECRET、OPS_API_KEY
npm run pm2
```

### 3. 上线自检

```bash
pm2 list
curl -s http://127.0.0.1:3000/healthz
pm2 logs dayizi-panel --lines 50 --nostream
```

---

## ⚙️ 环境变量说明

核心配置见 `.env.example`：

- **基础服务**：`PANEL_DOMAIN`、`PORT`（默认 `3000`）、`NODE_ENV`、`LOG_LEVEL`、`TZ`、`TRUST_PROXY`
- **安全密钥**：`SESSION_SECRET`、`OPS_API_KEY`（用于 `/ops/api/*` 鉴权）
- **订阅保护**：`SUB_LINK_SIGN_MODE`、`SUB_LINK_SIGN_PARAM`、`SUB_CLIENT_FILTER_MODE`、`SUB_UA_ALLOWLIST`、以及 `SUB_IP_*` / `SUB_TOKEN_*` / `SUB_BEHAVIOR_*` 限流参数
- **在线与异常检测**：`ONLINE_CACHE_TTL_MS`、`ONLINE_USER_WINDOW_MS`、`STALE_AGENT_THRESHOLD_MS`、`SUDDEN_ZERO_*`、`USER_MULTI_NODE_*`
- **数据保留**：`TRAFFIC_RAW_RETENTION_DAYS`、`TRAFFIC_DAILY_RETENTION_DAYS`

---

## 📁 目录结构

```text
.
├── src/
│   ├── app.js              # Express 5 应用入口与路由挂载
│   ├── middleware/         # 认证、CSRF、CSP、限流、OPS 鉴权、错误处理
│   ├── routes/             # 用户面板、认证、订阅、探针、农场、OPS API、Agent API 与管理后台 (admin/)
│   ├── services/           # 数据库、迁移、节点部署、AWS、健康巡检、通知、TG Bot、备份与 repos/
│   └── utils/              # VLESS/订阅签名、加密、时间、校验与通用工具
├── views/                  # EJS 服务端渲染模板
├── public/                 # 静态资源 (CSS/JS/图片)
├── templates/              # 节点安装脚本与国内探测脚本 (huawei-cn-probe.js 等)
├── node-agent/             # 节点端 WebSocket 长连接 Agent (node-agent/README.md)
├── container-core/         # Go 轻量化容器 VLESS-over-WS 核心 (container-core/README.md)
├── test/                   # Node.js 原生测试套件 (npm test)
├── install.sh              # 一键安装脚本
└── ecosystem.config.js     # PM2 进程配置
```

---

## 📖 关联文档

- 🔌 [API 接口参考](./README-API.md)
- 🤖 [Node Agent 文档](./node-agent/README.md)
- 📦 [Container Core 文档](./container-core/README.md)

## 📜 开源协议

[MIT License](./LICENSE)
