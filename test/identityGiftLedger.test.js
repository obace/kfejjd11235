process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-key-for-unit-testing-32chars';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const userRepo = require('../src/services/repos/userRepo');
const uuidRepo = require('../src/services/repos/uuidRepo');

test('anti-abuse: 1GB trial on first signup, 0GB on re-signup, 100GB on first TG bind, blocked on re-bind', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vless-anti-abuse-'));
  const dbPath = path.join(dir, 'panel.db');
  const db = new Database(dbPath);

  t.after(async () => {
    try { db.close(); } catch (_) {}
    await fsp.rm(dir, { recursive: true, force: true });
  });

  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auth_type TEXT,
      username TEXT NOT NULL,
      name TEXT,
      avatar_url TEXT,
      trust_level INTEGER DEFAULT 0,
      email TEXT,
      password_hash TEXT,
      oauth_provider TEXT,
      oauth_subject TEXT,
      sub_token TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      is_blocked INTEGER DEFAULT 0,
      is_frozen INTEGER DEFAULT 0,
      freeze_reason TEXT,
      traffic_limit INTEGER DEFAULT 0,
      telegram_id TEXT,
      tg_bind_token TEXT,
      last_login TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE traffic_user_total (
      user_id INTEGER PRIMARY KEY,
      total_up INTEGER DEFAULT 0,
      total_down INTEGER DEFAULT 0,
      free_bytes INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE traffic (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      node_id INTEGER NOT NULL,
      uplink INTEGER DEFAULT 0,
      downlink INTEGER DEFAULT 0,
      recorded_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE traffic_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      node_id INTEGER,
      date TEXT NOT NULL,
      uplink INTEGER DEFAULT 0,
      downlink INTEGER DEFAULT 0,
      UNIQUE(user_id, node_id, date)
    );
    CREATE TABLE user_node_uuid (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      node_id INTEGER NOT NULL,
      uuid TEXT NOT NULL,
      UNIQUE(user_id, node_id)
    );
    CREATE TABLE nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      min_level INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE identity_gift_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      identifier_type TEXT NOT NULL,
      identifier_val TEXT NOT NULL UNIQUE,
      trial_granted INTEGER DEFAULT 0,
      tg_gift_granted INTEGER DEFAULT 0,
      first_claimed_at TEXT DEFAULT (datetime('now')),
      last_claimed_at TEXT DEFAULT (datetime('now')),
      last_user_id INTEGER
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT,
      detail TEXT,
      ip TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE sub_access_log (id INTEGER PRIMARY KEY, user_id INTEGER);
    CREATE TABLE sub_access_event (id INTEGER PRIMARY KEY, user_id INTEGER);
    CREATE TABLE user_multi_node_observe_event (id INTEGER PRIMARY KEY, user_id INTEGER);
  `);

  // 插入一个测试节点
  db.prepare("INSERT INTO nodes (id, name, min_level) VALUES (1, 'Node 1', 0)").run();

  // 初始化 repo
  userRepo.init({
    getDb: () => db,
    getSetting: (k) => {
      if (k === 'default_traffic_limit') return '107374182400'; // 100GB
      if (k === 'default_user_group') return '0';
      return '0';
    },
    notify: { userRegister: () => {} },
    addAuditLog: () => {},
    ensureUserHasAllNodeUuids: (uid) => {
      db.prepare('INSERT OR IGNORE INTO user_node_uuid (user_id, node_id, uuid) VALUES (?, 1, ?)').run(uid, 'uuid-' + uid);
    },
    removeFromRegisterWhitelist: () => {},
  });

  uuidRepo.init({
    getDb: () => db,
    getAllUsers: () => db.prepare('SELECT * FROM users').all(),
  });

  // 1. 模拟管理员存在
  db.prepare(`
    INSERT INTO users (id, auth_type, username, sub_token, is_admin, traffic_limit)
    VALUES (1, 'admin', 'admin', 'tok-admin', 1, -1)
  `).run();

  // 2. 首次注册：普通用户通过 NodeLoc OAuth 注册
  const user1 = userRepo.createOAuthUser({
    provider: 'nodeloc',
    subject: '1001',
    usernameSeed: 'testuser',
    email: 'test@example.com',
  });

  assert.equal(user1.traffic_limit, 1073741824, '首次注册应获得 1GB 体验流量');
  assert.equal(userRepo.isTrafficExceeded(user1.id), false, '1GB 体验流量未消耗前不应超限');

  // 节点下发用户检查：user1 应当在节点名单中
  const nodeUsers1 = uuidRepo.getNodeAllUserUuids(1);
  assert.ok(nodeUsers1.some(u => u.user_id === user1.id), '拥有 1GB 体验流量的用户可以连接节点');

  // 3. 模拟用户未绑定 TG，7天后账号被系统自动删除
  userRepo.deleteUserCascade(user1.id);
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM users WHERE id = ?').get(user1.id).c, 0);

  // 检查防刷账本中依然保留了该身份记录
  const ledgerRecord = db.prepare("SELECT * FROM identity_gift_ledger WHERE identifier_val = 'oauth:nodeloc:1001'").get();
  assert.ok(ledgerRecord, '删号后 identity_gift_ledger 必须保留记录');
  assert.equal(ledgerRecord.trial_granted, 1, '应记录该身份已领取过 1GB 体验流量');

  // 4. 第二次再次注册：同一 NodeLoc 身份再次登录
  const user2 = userRepo.createOAuthUser({
    provider: 'nodeloc',
    subject: '1001',
    usernameSeed: 'testuser',
    email: 'test@example.com',
  });

  assert.equal(user2.traffic_limit, 0, '二次注册不得再获得 1GB 体验流量，额度应为 0');
  assert.equal(userRepo.isTrafficExceeded(user2.id), true, '额度为 0 的用户应判定为流量超限');

  // 节点下发检查：user2 额度为 0，绝对不能出现在节点名单中！
  const nodeUsers2 = uuidRepo.getNodeAllUserUuids(1);
  assert.ok(!nodeUsers2.some(u => u.user_id === user2.id), '额度为 0 的用户不得下发到节点，无法使用节点');

  // 5. 绑定 Telegram：首次绑定
  db.prepare('UPDATE users SET telegram_id = ? WHERE id = ?').run('12345678', user2.id);
  const giftRes1 = userRepo.grantTgBindGift(user2.id);
  assert.equal(giftRes1.granted, true, '首次绑定 TG 应发放 100GB 礼包');
  assert.equal(giftRes1.bytes, 107374182400, '发放额度应为 100GB');

  const user2After = userRepo.getUserById(user2.id);
  assert.equal(user2After.traffic_limit, 107374182400, '绑定后流量配额增加到 100GB');
  assert.equal(userRepo.isTrafficExceeded(user2.id), false, '获得 100GB 流量后不再超限');

  // 6. 模拟 30 天未签到被强制删号
  userRepo.deleteUserCascade(user2.id);
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM users WHERE id = ?').get(user2.id).c, 0);

  // 7. 用户再次注册（第三次注册），试图重新绑定薅 100GB 羊毛
  const user3 = userRepo.createOAuthUser({
    provider: 'nodeloc',
    subject: '1001',
    usernameSeed: 'testuser',
    email: 'test@example.com',
  });
  assert.equal(user3.traffic_limit, 0, '再次注册依然 0 流量');

  // 尝试再次绑定相同的 TG 账号
  db.prepare('UPDATE users SET telegram_id = ? WHERE id = ?').run('12345678', user3.id);
  const giftRes2 = userRepo.grantTgBindGift(user3.id);

  assert.equal(giftRes2.granted, false, '重复绑定同一 TG 账号不得再次发放 100GB 礼包');
  assert.equal(giftRes2.alreadyClaimed, true, '应标记为 alreadyClaimed 防刷拦截');

  const user3After = userRepo.getUserById(user3.id);
  assert.equal(user3After.traffic_limit, 0, '配额保持为 0，防止循环薅羊毛');
  assert.equal(userRepo.isTrafficExceeded(user3.id), true, '配额为 0 依然超限，无法免费使用');
});
