const express = require('express');
const db = require('../services/database');
const farm = require('../services/farm');
const { verifyTgInitData } = require('../utils/tgGame');

const router = express.Router();

// 农场页面（支持 TG WebApp 与网站直接访问）
router.get('/farm-game', (req, res) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self' https://web.telegram.org https://desktop.telegram.org");
  res.render('farm-game', { nonce: res.locals.nonce || '' });
});

// 仙姑灵签页面（支持网站直接访问与 TG WebApp）
router.get('/fortune', (req, res) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self' https://web.telegram.org https://desktop.telegram.org");
  res.render('fortune', { nonce: res.locals.nonce || '' });
});

// 支持 TG initData 认证 + 网站登录 Session 双认证
function resolveUser(req) {
  const initData = req.body?.initData;
  if (initData) {
    const tgUser = verifyTgInitData(initData);
    if (!tgUser || tgUser.id == null) return { error: '验证失败' };
    const user = db.getDb().prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(tgUser.id));
    if (!user) return { error: '未绑定账号，请先在机器人里绑定' };
    if (user.is_blocked) return { error: '账号已被封禁' };
    return { user };
  }
  if (req.isAuthenticated && req.isAuthenticated() && req.user?.id) {
    const user = db.getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user) return { error: '用户不存在' };
    if (user.is_blocked) return { error: '账号已被封禁' };
    if (!user.telegram_id) return { error: '请先绑定 Telegram 账号后再进行签到和种菜', unboundTg: true };
    return { user };
  }
  return { error: '请先登录网站面板或在 Telegram 机器人中打开农场' };
}

// 组装返回给前端的完整状态
function buildPayload(user) {
  const st = farm.getState(user);
  return {
    ok: true,
    group: Math.min(Math.max(user.trust_level || 0, 0), 3),
    unlocked: st.unlocked,
    totalPlots: farm.TOTAL_PLOTS,
    seeds: st.seeds,
    seedCap: st.seedCap,
    cropYieldGb: st.cropYieldGb,
    cropName: st.cropName,
    cropEmoji: st.cropEmoji,
    matureCount: st.matureCount,
    plots: st.plots.map(p => ({
      slot: p.slot,
      locked: p.locked,
      planted: !!p.crop,
      mature: p.crop ? p.mature : false,
      remainingSec: p.crop ? p.remainingSec : 0,
      totalSec: p.crop ? p.totalSec : 0,
      expectedGb: p.crop ? p.expectedGb : 0,
    })),
  };
}

// 状态
router.post('/farm/api/state', express.json(), (req, res) => {
  const r = resolveUser(req);
  if (r.error) return res.json({ ok: false, error: r.error });
  res.json(buildPayload(r.user));
});

// 播种（消耗 1 颗种子，无需选作物）
router.post('/farm/api/plant', express.json(), (req, res) => {
  const r = resolveUser(req);
  if (r.error) return res.json({ ok: false, error: r.error });
  const slot = Number(req.body?.slot);
  const result = farm.plant(r.user, slot);
  const payload = buildPayload(db.getDb().prepare('SELECT * FROM users WHERE id = ?').get(r.user.id));
  res.json({ ...payload, action: result });
});

// 收获单块
router.post('/farm/api/harvest', express.json(), (req, res) => {
  const r = resolveUser(req);
  if (r.error) return res.json({ ok: false, error: r.error });
  const slot = Number(req.body?.slot);
  const result = farm.harvest(r.user, slot);
  const payload = buildPayload(db.getDb().prepare('SELECT * FROM users WHERE id = ?').get(r.user.id));
  res.json({ ...payload, action: result });
});

// 一键收获
router.post('/farm/api/harvest-all', express.json(), (req, res) => {
  const r = resolveUser(req);
  if (r.error) return res.json({ ok: false, error: r.error });
  const result = farm.harvestAll(r.user);
  const payload = buildPayload(db.getDb().prepare('SELECT * FROM users WHERE id = ?').get(r.user.id));
  res.json({ ...payload, action: result });
});

// 随机访问一个邻居农场（无好友系统，纯随机串门偷菜）
router.post('/farm/api/visit', express.json(), (req, res) => {
  const r = resolveUser(req);
  if (r.error) return res.json({ ok: false, error: r.error });
  res.json(farm.getRandomFarm(r.user));
});

// 偷一块邻居的成熟作物
router.post('/farm/api/steal', express.json(), (req, res) => {
  const r = resolveUser(req);
  if (r.error) return res.json({ ok: false, error: r.error });
  const victimId = Number(req.body?.victimId);
  const slot = Number(req.body?.slot);
  res.json(farm.steal(r.user, victimId, slot));
});

// 每日签到（TG 与网站共用同一套签到记录与发种子逻辑）
router.post('/farm/api/checkin', express.json(), (req, res) => {
  const r = resolveUser(req);
  if (r.error) return res.json({ ok: false, unboundTg: !!r.unboundTg, error: r.error });
  const { executeCheckinForUser } = require('../services/tgbot');
  const checkinRes = executeCheckinForUser(r.user);
  const freshUser = db.getDb().prepare('SELECT * FROM users WHERE id = ?').get(r.user.id);
  const payload = buildPayload(freshUser);
  res.json({ ...payload, checkin: checkinRes });
});

// 每月求签状态
router.post('/farm/api/fortune/state', express.json(), (req, res) => {
  const r = resolveUser(req);
  if (r.error) return res.json({ ok: false, unboundTg: !!r.unboundTg, error: r.error });
  const fortune = require('../services/fortune');
  res.json(fortune.getState(r.user));
});

// 每月求签摇签
router.post('/farm/api/fortune/draw', express.json(), (req, res) => {
  const r = resolveUser(req);
  if (r.error) return res.json({ ok: false, unboundTg: !!r.unboundTg, error: r.error });
  const fortune = require('../services/fortune');
  res.json(fortune.drawFortune(r.user));
});

module.exports = router;
