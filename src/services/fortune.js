// 每月求签小游戏 —— 按当前剩余流量比例加成（无封顶）
// 上上签(10%): +100%(翻倍) | 上吉签(25%): +50% | 中吉签(40%): +25% | 小吉签(25%): +10%
const db = require('./database');
const { today } = require('../utils/tgGame');

const TIERS = [
  {
    key: 'ss',
    levelName: '上上签',
    badge: '🏮 上上签',
    rate: 1.0,
    rateLabel: '+100%（翻倍）',
    weight: 10,
    color: '#f43f5e',
    poems: [
      { title: '天降横财', text: '春风得意马蹄疾，流量翻倍不费力。\n今日仙姑赐洪福，秒开万里永不卡！' },
      { title: '紫气东来', text: '金鳞岂是池中物，一朝风云化真龙。\n月华宝莲连夜开，剩余流量翻一番！' },
      { title: '鸿运当头', text: '瑶池仙露落凡间，万水千山一线牵。\n上上吉签入手中，直接翻倍笑开颜！' },
    ],
  },
  {
    key: 's',
    levelName: '上吉签',
    badge: '🌸 上吉签',
    rate: 0.5,
    rateLabel: '+50%',
    weight: 25,
    color: '#fb923c',
    poems: [
      { title: '桃花朵朵', text: '洞房花烛夜微凉，佳人浅笑意正长。\n仙气加持五成满，晚高峰里亦通畅！' },
      { title: '乘风破浪', text: '长风破浪会有时，直挂云帆济沧海。\n凭此吉签增半数，纵横四海任尔行！' },
      { title: '吉星高照', text: '明月清风伴君游，五成仙力入囊中。\n莫愁前路无流量，自有贵人暗相助！' },
    ],
  },
  {
    key: 'a',
    levelName: '中吉签',
    badge: '🎋 中吉签',
    rate: 0.25,
    rateLabel: '+25%',
    weight: 40,
    color: '#fbbf24',
    poems: [
      { title: '顺风顺水', text: '竹外桃花三两枝，春江水暖鸭先知。\n吉签天成添四一，细水长流正当时！' },
      { title: '步步高升', text: '山重水复疑无路，柳暗花明又一村。\n再添二成五仙气，日常冲浪稳如山！' },
      { title: '清风徐来', text: '清风徐来水波兴，月满西楼夜色明。\n中吉之兆虽平淡，胜在长久与安宁！' },
    ],
  },
  {
    key: 'b',
    levelName: '小吉签',
    badge: '🍀 小吉签',
    rate: 0.10,
    rateLabel: '+10%',
    weight: 25,
    color: '#34d399',
    poems: [
      { title: '稳中向好', text: '不积跬步无千里，不积小流无江海。\n今日小吉添一成，勤种宝莲福自来！' },
      { title: '细水长流', text: '平平淡淡才是真，一成加持亦暖心。\n下月再来摇签筒，定叫乾坤换新颜！' },
      { title: '岁月静好', text: '闲看庭前花开花落，漫随天外云卷云舒。\n小吉入怀添一成，安稳顺遂度今朝！' },
    ],
  },
];

function currentMonth() {
  return today().slice(0, 7); // YYYY-MM (Asia/Shanghai)
}

function ensureTables() {
  db.getDb().exec(`
    CREATE TABLE IF NOT EXISTS tg_fortune_draws (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      tier_key TEXT NOT NULL,
      level_name TEXT NOT NULL,
      title TEXT NOT NULL,
      poem TEXT NOT NULL,
      rate REAL NOT NULL,
      before_remaining_bytes INTEGER NOT NULL DEFAULT 0,
      bonus_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, month)
    );
    CREATE INDEX IF NOT EXISTS idx_fortune_user_month ON tg_fortune_draws(user_id, month);
  `);
}

function getUserRemainingBytes(user) {
  const traffic = db.getUserTraffic(user.id);
  const used = (traffic.total_up || 0) + (traffic.total_down || 0);
  const billedUsed = traffic.billed_total != null ? traffic.billed_total : used;
  const limit = user.traffic_limit;
  if (limit < 0) return { infinite: true, remainingBytes: -1 };
  return { infinite: false, remainingBytes: Math.max(0, limit - billedUsed) };
}

function pickRandomTier() {
  const totalWeight = TIERS.reduce((acc, t) => acc + t.weight, 0);
  let r = Math.random() * totalWeight;
  for (const t of TIERS) {
    if (r < t.weight) return t;
    r -= t.weight;
  }
  return TIERS[TIERS.length - 1];
}

function formatRecord(row) {
  if (!row) return null;
  const tier = TIERS.find(t => t.key === row.tier_key) || TIERS[2];
  return {
    month: row.month,
    tierKey: row.tier_key,
    levelName: row.level_name,
    badge: tier.badge,
    color: tier.color,
    rate: row.rate,
    rateLabel: `+${Math.round(row.rate * 100)}%${row.rate === 1 ? '（翻倍）' : ''}`,
    title: row.title,
    poem: row.poem,
    beforeRemainingBytes: row.before_remaining_bytes,
    bonusBytes: row.bonus_bytes,
    afterRemainingBytes: row.before_remaining_bytes < 0 ? -1 : row.before_remaining_bytes + row.bonus_bytes,
    createdAt: row.created_at,
  };
}

function getState(user) {
  ensureTables();
  const month = currentMonth();
  const row = db.getDb().prepare('SELECT * FROM tg_fortune_draws WHERE user_id = ? AND month = ?').get(user.id, month);
  const rem = getUserRemainingBytes(user);
  return {
    ok: true,
    month,
    drawn: !!row,
    record: formatRecord(row),
    infinite: rem.infinite,
    remainingBytes: rem.remainingBytes,
  };
}

function drawFortune(user) {
  ensureTables();
  if (!user || !user.id) return { ok: false, error: '用户不存在' };
  if (user.is_blocked) return { ok: false, error: '账号已被封禁' };
  if (!user.telegram_id) {
    return { ok: false, unboundTg: true, error: '请先绑定 Telegram 账号后再进行求签' };
  }

  const month = currentMonth();
  const existing = db.getDb().prepare('SELECT * FROM tg_fortune_draws WHERE user_id = ? AND month = ?').get(user.id, month);
  if (existing) {
    return {
      ok: false,
      alreadyDrawn: true,
      error: '本月已经求过签啦，请下月再来～',
      record: formatRecord(existing),
    };
  }

  const freshUser = db.getUserById(user.id);
  const rem = getUserRemainingBytes(freshUser);
  if (!rem.infinite && rem.remainingBytes <= 0) {
    return {
      ok: false,
      zeroTraffic: true,
      error: '你当前的剩余流量为 0，翻倍后仍为 0 哦！请先去农场种菜收获流量后再来求签，以免浪费本月机会～',
    };
  }

  const tier = pickRandomTier();
  const poemObj = tier.poems[Math.floor(Math.random() * tier.poems.length)];
  const beforeBytes = rem.infinite ? -1 : rem.remainingBytes;
  const bonusBytes = rem.infinite ? 0 : Math.round(beforeBytes * tier.rate);

  const tx = db.getDb().transaction(() => {
    const ins = db.getDb().prepare(`
      INSERT OR IGNORE INTO tg_fortune_draws
        (user_id, month, tier_key, level_name, title, poem, rate, before_remaining_bytes, bonus_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, month, tier.key, tier.levelName, poemObj.title, poemObj.text, tier.rate, beforeBytes, bonusBytes);

    if (ins.changes === 0) {
      return null;
    }

    if (!rem.infinite && bonusBytes > 0) {
      db.getDb().prepare('UPDATE users SET traffic_limit = traffic_limit + ? WHERE id = ? AND traffic_limit >= 0').run(bonusBytes, user.id);
    }

    const bonusGb = (bonusBytes / 1073741824).toFixed(2);
    db.addAuditLog(user.id, 'fortune_draw', `${month} 求签【${tier.levelName}·${poemObj.title}】(+${Math.round(tier.rate * 100)}%) 获赠 ${bonusGb} GB`, 'web_fortune');
    return db.getDb().prepare('SELECT * FROM tg_fortune_draws WHERE user_id = ? AND month = ?').get(user.id, month);
  });

  const savedRow = tx();
  if (!savedRow) {
    const row = db.getDb().prepare('SELECT * FROM tg_fortune_draws WHERE user_id = ? AND month = ?').get(user.id, month);
    return {
      ok: false,
      alreadyDrawn: true,
      error: '本月已经求过签啦，请下月再来～',
      record: formatRecord(row),
    };
  }

  return {
    ok: true,
    month,
    record: formatRecord(savedRow),
  };
}

module.exports = {
  getState,
  drawFortune,
};
