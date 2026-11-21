# 大姨子的诱惑 (Dayizi Panel)

面向个人与小团队的高能多协议代理管理面板，将用户管理、节点编排、智能订阅、流量统计、互动娱乐以及 AI 自动化运维无缝集成至同一系统。

## 🌟 核心特性

- **多协议支持**：支持 VLESS Reality (TCP/WS)、Shadowsocks 以及 Hysteria 2。
- **用户与配额**：邮箱注册登录，支持用户分组、流量配额限制、过期与不活跃自动冻结。
- **智能订阅分发**：自动识别客户端 UA（Clash / Sing-box / V2Ray / Shadowrocket 等），下发适配配置。
- **节点自动部署**：一键部署远程 VPS，支持挂载 SOCKS5 落地出口与 AWS 集成自动换 IP。
- **Telegram Bot 与互动**：支持每日签到领流量、农场月华宝莲种植、月度求签翻倍流量及节点状态即时通知。
- **实时探针与全网网速**：全网实时下行/上行带宽与累计流量动态统计，实时监控各节点 CPU/内存/磁盘/带宽/延迟。
- **运维与安全保障**：提供 OPS API 与数据库一键备份恢复，全量安全中间件防护。

## 🚀 一键安装

适用于 Debian 11+ / Ubuntu 20.04+ 系统：

```bash
bash <(curl -sL https://raw.githubusercontent.com/obace/kfejjd11235/main/install.sh)
```

## 📚 延伸文档

- 📖 [完整项目说明](./README.md)
- 📘 [管理后台指南](./ADMIN-GUIDE.md)
- 🔌 [API 接口参考](./README-API.md)
- 📋 [上线检查清单](./DEPLOY-CHECKLIST.md)
- 📝 [版本更新日志](./CHANGELOG.md)

## 📜 开源协议

[MIT License](./LICENSE)
