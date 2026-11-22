const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const userRepo = require('../src/services/repos/userRepo');

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'test-secret';
}

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      telegram_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      is_admin INTEGER DEFAULT 0,
      is_frozen INTEGER DEFAULT 0,
      is_blocked INTEGER DEFAULT 0,
      traffic_limit INTEGER DEFAULT -1,
      sub_token TEXT,
      expires_at TEXT
    );

    CREATE TABLE tg_checkin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      amount INTEGER NOT NULL
    );

    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      detail TEXT,
      ip TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return db;
}

test('getNoCheckinUsersForWarning: 正确识别第29天未签到用户与防重', () => {
  const db = createTestDb();
  userRepo.init({
    getDb: () => db,
    getSetting: () => 'true',
    addAuditLog: (uid, act, det, ip) => {
      db.prepare('INSERT INTO audit_log (user_id, action, detail, ip) VALUES (?, ?, ?, ?)').run(uid, act, det, ip);
    },
    ensureUserHasAllNodeUuids: () => {},
    onUserCreated: () => {}
  });

  const now = Date.now();
  const d10 = new Date(now - 10 * 86400000).toISOString().slice(0, 10);
  const d29 = new Date(now - 29 * 86400000).toISOString().slice(0, 10);
  const d31 = new Date(now - 31 * 86400000).toISOString().slice(0, 10);

  // 用户1: 活跃用户（10天前签到）
  db.prepare("INSERT INTO users (id, username, telegram_id, is_admin) VALUES (1, 'u_active', '1001', 0)").run();
  db.prepare("INSERT INTO tg_checkin (user_id, date, amount) VALUES (1, ?, 100)").run(d10);

  // 用户2: 达到29天未签到（应预警）
  db.prepare("INSERT INTO users (id, username, telegram_id, is_admin) VALUES (2, 'u_warn', '1002', 0)").run();
  db.prepare("INSERT INTO tg_checkin (user_id, date, amount) VALUES (2, ?, 100)").run(d29);

  // 用户3: 达到31天未签到（应直接删除，不在预警列表中）
  db.prepare("INSERT INTO users (id, username, telegram_id, is_admin) VALUES (3, 'u_delete', '1003', 0)").run();
  db.prepare("INSERT INTO tg_checkin (user_id, date, amount) VALUES (3, ?, 100)").run(d31);

  // 用户4: 29天未签到但没有绑定TG（跳过）
  db.prepare("INSERT INTO users (id, username, telegram_id, is_admin) VALUES (4, 'u_nobind', NULL, 0)").run();
  db.prepare("INSERT INTO tg_checkin (user_id, date, amount) VALUES (4, ?, 100)").run(d29);

  // 用户5: 29天未签到但是管理员（跳过）
  db.prepare("INSERT INTO users (id, username, telegram_id, is_admin) VALUES (5, 'u_admin', '1005', 1)").run();
  db.prepare("INSERT INTO tg_checkin (user_id, date, amount) VALUES (5, ?, 100)").run(d29);

  // 执行查询预警列表
  const warnList = userRepo.getNoCheckinUsersForWarning(30);
  assert.equal(warnList.length, 1, '应仅匹配到 u_warn 用户');
  assert.equal(warnList[0].username, 'u_warn');
  assert.equal(warnList[0].telegram_id, '1002');

  // 记录审计日志模拟预警发送完成
  db.prepare("INSERT INTO audit_log (user_id, action, detail, ip, created_at) VALUES (2, 'warn_no_checkin', '预警通知', 'system', datetime('now'))").run();

  // 再次查询预警列表，由于防重机制，u_warn 应该被过滤掉
  const warnListAfter = userRepo.getNoCheckinUsersForWarning(30);
  assert.equal(warnListAfter.length, 0, '已发送过预警的用户在防重窗口内应被过滤');

  db.close();
});
