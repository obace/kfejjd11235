const crypto = require('crypto');
const { toSqlUtc } = require('../../utils/time');
const logger = require('../logger');

let _getDb, _getSetting, _addAuditLog, _ensureUserHasAllNodeUuids, _onUserCreated, _notify;

function init(deps) {
  _getDb = deps.getDb;
  _getSetting = deps.getSetting;
  _addAuditLog = deps.addAuditLog;
  _ensureUserHasAllNodeUuids = deps.ensureUserHasAllNodeUuids || (() => {});
  _onUserCreated = deps.onUserCreated || (() => {});
  _notify = deps.notify;
}

function genSubToken() {
  // 24 字节 = 192 位熵，base64url 编码后 32 字符。
  // 因 token 在 URL 中暴露，使用更高熵以防暴力预测。
  return crypto.randomBytes(24).toString('base64url');
}

function getUserBySubToken(token) {
  return _getDb().prepare('SELECT * FROM users WHERE sub_token = ? AND is_blocked = 0').get(token);
}

function getUserById(id) {
  return _getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getUsersByIds(ids = []) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(id => parseInt(id, 10)).filter(id => id > 0))];
  if (list.length === 0) return [];
  const placeholders = list.map(() => '?').join(', ');
  return _getDb().prepare(`SELECT * FROM users WHERE id IN (${placeholders})`).all(...list);
}

function getUserByUsername(username) {
  const name = String(username || '').trim();
  if (!name) return null;
  return _getDb().prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(name) || null;
}

function getUserByEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value) return null;
  return _getDb().prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(value) || null;
}

function getUserByOAuth(provider, subject) {
  const p = String(provider || '').trim();
  const s = String(subject || '').trim();
  if (!p || !s) return null;
  return _getDb().prepare('SELECT * FROM users WHERE oauth_provider = ? AND oauth_subject = ?').get(p, s) || null;
}

function normalizeUsernameSeed(seed) {
  return (String(seed || '').split('@')[0] || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 32) || `user${Date.now().toString().slice(-6)}`;
}

function resolveAvailableUsername(seed) {
  const base = normalizeUsernameSeed(seed);
  if (!getUserByUsername(base)) return base;
  for (let i = 1; i < 10000; i += 1) {
    const suffix = String(i);
    const cut = Math.max(1, 32 - suffix.length);
    const candidate = `${base.slice(0, cut)}${suffix}`;
    if (!getUserByUsername(candidate)) return candidate;
  }
  return `${base.slice(0, 24)}${Date.now().toString().slice(-8)}`;
}

const TRIAL_TRAFFIC_BYTES = 1073741824; // 1GB 体验流量

function isEligibleForTrial({ oauthProvider, oauthSubject, email } = {}) {
  const d = _getDb();
  const keys = [];
  if (oauthProvider && oauthSubject) keys.push(`oauth:${oauthProvider}:${oauthSubject}`);
  if (email) keys.push(`email:${String(email).toLowerCase().trim()}`);
  if (keys.length === 0) return true;
  try {
    const placeholders = keys.map(() => '?').join(',');
    const row = d.prepare(`SELECT 1 FROM identity_gift_ledger WHERE identifier_val IN (${placeholders}) AND trial_granted = 1 LIMIT 1`).get(...keys);
    return !row;
  } catch (_) {
    return true;
  }
}

function recordTrialGranted({ oauthProvider, oauthSubject, email, userId } = {}) {
  const d = _getDb();
  const keys = [];
  if (oauthProvider && oauthSubject) keys.push({ type: 'oauth', val: `oauth:${oauthProvider}:${oauthSubject}` });
  if (email) keys.push({ type: 'email', val: `email:${String(email).toLowerCase().trim()}` });
  for (const item of keys) {
    try {
      d.prepare(`
        INSERT INTO identity_gift_ledger (identifier_type, identifier_val, trial_granted, tg_gift_granted, last_user_id)
        VALUES (?, ?, 1, 0, ?)
        ON CONFLICT(identifier_val) DO UPDATE SET
          trial_granted = 1,
          last_user_id = excluded.last_user_id,
          last_claimed_at = datetime('now')
      `).run(item.type, item.val, userId || null);
    } catch (_) {}
  }
}

function getDefaultSignupSettings({ oauthProvider, oauthSubject, email } = {}) {
  const userCount = _getDb().prepare('SELECT COUNT(*) as count FROM users').get().count;
  const isAdmin = userCount === 0 ? 1 : 0;
  const defaultLimit = parseInt(_getSetting('default_traffic_limit'), 10);
  const configuredLimit = isNaN(defaultLimit) ? -1 : defaultLimit;
  const defaultGroup = parseInt(_getSetting('default_user_group'), 10);

  let trafficLimit = 0;
  if (isAdmin) {
    trafficLimit = configuredLimit;
  } else {
    // 首次注册赠送 1GB 体验流量；如果历史已领过（如二次注册），则赠送 0 流量
    const canGetTrial = isEligibleForTrial({ oauthProvider, oauthSubject, email });
    trafficLimit = canGetTrial ? TRIAL_TRAFFIC_BYTES : 0;
  }

  return {
    isAdmin,
    trafficLimit,
    trustLevel: Number.isFinite(defaultGroup) ? Math.max(0, Math.min(3, defaultGroup)) : 0,
  };
}

function insertEmailUser({ username, email, passwordHash, displayName }) {
  const cleanUsername = String(username || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanUsername || !cleanEmail || !passwordHash) {
    throw new Error('invalid input');
  }
  const subToken = genSubToken();
  const { isAdmin, trafficLimit, trustLevel } = getDefaultSignupSettings({ email: cleanEmail });
  const name = String(displayName || cleanUsername).trim();

  const initialFrozen = (!isAdmin && trafficLimit === 0) ? 1 : 0;
  const initialFreezeReason = (!isAdmin && trafficLimit === 0) ? 'traffic_limit' : null;

  _getDb().prepare(`
    INSERT INTO users (auth_type, username, name, trust_level, email, password_hash, sub_token, is_admin, is_frozen, freeze_reason, traffic_limit, last_login)
    VALUES ('email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(cleanUsername, name, trustLevel, cleanEmail, passwordHash, subToken, isAdmin, initialFrozen, initialFreezeReason, trafficLimit);

  const newUser = _getDb().prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(cleanEmail);
  if (newUser && trafficLimit > 0 && !isAdmin) {
    recordTrialGranted({ email: cleanEmail, userId: newUser.id });
  }

  return {
    newUser,
    isAdmin,
    cleanUsername,
    cleanEmail,
  };
}

function createOAuthUser({ provider, subject, usernameSeed, email, displayName, avatarUrl, ip = 'system' }) {
  const cleanProvider = String(provider || '').trim();
  const cleanSubject = String(subject || '').trim();
  if (!cleanProvider || !cleanSubject) throw new Error('invalid oauth identity');

  const existing = getUserByOAuth(cleanProvider, cleanSubject);
  if (existing) return existing;

  const username = resolveAvailableUsername(usernameSeed || email || cleanSubject);
  const cleanEmail = String(email || '').trim().toLowerCase() || null;
  const name = String(displayName || username).trim();
  const avatar = String(avatarUrl || '').trim() || null;
  const subToken = genSubToken();
  const { isAdmin, trafficLimit, trustLevel } = getDefaultSignupSettings({ oauthProvider: cleanProvider, oauthSubject: cleanSubject, email: cleanEmail });

  const initialFrozen = (!isAdmin && trafficLimit === 0) ? 1 : 0;
  const initialFreezeReason = (!isAdmin && trafficLimit === 0) ? 'traffic_limit' : null;

  _getDb().prepare(`
    INSERT INTO users (auth_type, username, name, avatar_url, trust_level, email, password_hash, oauth_provider, oauth_subject, sub_token, is_admin, is_frozen, freeze_reason, traffic_limit, last_login)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(cleanProvider, username, name, avatar, trustLevel, cleanEmail, cleanProvider, cleanSubject, subToken, isAdmin, initialFrozen, initialFreezeReason, trafficLimit);

  const newUser = getUserByOAuth(cleanProvider, cleanSubject);
  if (newUser && trafficLimit > 0 && !isAdmin) {
    recordTrialGranted({ oauthProvider: cleanProvider, oauthSubject: cleanSubject, email: cleanEmail, userId: newUser.id });
  }
  _addAuditLog(null, 'user_register_oauth', `${cleanProvider} 登录创建用户: ${username}${isAdmin ? ' (管理员)' : ''}`, ip);

  try {
    const n = _notify || require('../notify').notify;
    if (n?.userRegister) n.userRegister(username, { username, email: cleanEmail });
  } catch (err) {
    logger.debug({ err, username }, '发送用户注册通知失败，已忽略');
  }

  _ensureUserHasAllNodeUuids(newUser.id);
  _onUserCreated(newUser.id);
  return newUser;
}

function createEmailUser({ username, email, passwordHash, displayName, ip = 'system' }) {
  const { newUser, isAdmin, cleanUsername, cleanEmail } = insertEmailUser({ username, email, passwordHash, displayName });
  if (isAdmin) logger.info({ username: cleanUsername }, '首位用户已自动设为管理员');

  _addAuditLog(null, 'user_register_email', `邮箱注册: ${cleanUsername}${isAdmin ? ' (管理员)' : ''}`, ip);

  try {
    const n = _notify || require('../notify').notify;
    if (n?.userRegister) n.userRegister(cleanUsername, { username: cleanUsername, email: cleanEmail });
  } catch (err) {
    logger.debug({ err, username: cleanUsername }, '发送用户注册通知失败，已忽略');
  }

  _ensureUserHasAllNodeUuids(newUser.id);
  _onUserCreated(newUser.id);
  return newUser;
}

function createInvitedEmailUser({ username, email, passwordHash, displayName, inviteCode, ip = 'system' }) {
  const cleanInviteCode = String(inviteCode || '').trim().toUpperCase();
  if (!cleanInviteCode) {
    throw new Error('invite required');
  }

  const tx = _getDb().transaction(() => {
    const invite = _getDb().prepare(`
      SELECT *
      FROM invite_codes
      WHERE code = ?
        AND used_at IS NULL
        AND expires_at > datetime('now')
      LIMIT 1
    `).get(cleanInviteCode);
    if (!invite) {
      throw new Error('invalid invite');
    }

    const { newUser, isAdmin, cleanUsername, cleanEmail } = insertEmailUser({ username, email, passwordHash, displayName });
    const mark = _getDb().prepare(`
      UPDATE invite_codes
      SET used_at = datetime('now'), used_by_user_id = ?
      WHERE id = ?
        AND used_at IS NULL
    `).run(newUser.id, invite.id);
    if (mark.changes !== 1) {
      throw new Error('invite already used');
    }

    return { newUser, isAdmin, cleanUsername, cleanEmail, inviterUserId: invite.inviter_user_id };
  });

  const { newUser, isAdmin, cleanUsername, cleanEmail, inviterUserId } = tx();
  if (isAdmin) logger.info({ username: cleanUsername }, '首位用户已自动设为管理员');

  _addAuditLog(null, 'user_register_email', `邮箱注册: ${cleanUsername}${isAdmin ? ' (管理员)' : ''} 邀请人:${inviterUserId}`, ip);

  try {
    const n = _notify || require('../notify').notify;
    if (n?.userRegister) n.userRegister(cleanUsername, { username: cleanUsername, email: cleanEmail });
  } catch (err) {
    logger.debug({ err, username: cleanUsername }, '发送用户注册通知失败，已忽略');
  }

  _ensureUserHasAllNodeUuids(newUser.id);
  _onUserCreated(newUser.id);
  return newUser;
}

function getUserCount() {
  return _getDb().prepare('SELECT COUNT(*) as count FROM users').get().count;
}

function getTgBoundUserCount() {
  return _getDb().prepare("SELECT COUNT(*) as count FROM users WHERE telegram_id IS NOT NULL AND telegram_id != ''").get().count;
}

// 绑定 TG 后发放注册赠送 100GB 流量（防刷账本记录，同身份/同 TG 仅可领取一次）
function grantTgBindGift(userId) {
  const d = _getDb();
  const u = d.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u) return { granted: false, alreadyClaimed: false, bytes: 0 };

  const tgId = u.telegram_id;
  const keys = [];
  if (tgId) keys.push(`tg:${tgId}`);
  if (u.oauth_provider && u.oauth_subject) keys.push(`oauth:${u.oauth_provider}:${u.oauth_subject}`);
  if (u.email) keys.push(`email:${u.email.toLowerCase().trim()}`);

  // 检查是否已经在历史中领取过 100GB 绑定礼包（防刷）
  let alreadyClaimed = false;
  if (keys.length > 0) {
    try {
      const placeholders = keys.map(() => '?').join(',');
      const row = d.prepare(`SELECT 1 FROM identity_gift_ledger WHERE identifier_val IN (${placeholders}) AND tg_gift_granted = 1 LIMIT 1`).get(...keys);
      alreadyClaimed = !!row;
    } catch (_) {
      alreadyClaimed = false;
    }
  }

  if (alreadyClaimed) {
    return { granted: false, alreadyClaimed: true, bytes: 0 };
  }

  // 首次领取：发放 100GB（增加到当前配额上）
  const raw = parseInt(_getSetting('default_traffic_limit'), 10);
  const giftBytes = (!Number.isFinite(raw) || raw < 0) ? (100 * 1024 * 1024 * 1024) : raw;

  if (u.traffic_limit >= 0) {
    d.prepare('UPDATE users SET traffic_limit = traffic_limit + ? WHERE id = ?').run(giftBytes, userId);
  }

  // 记录到防刷礼包账本
  const recordList = [];
  if (tgId) recordList.push({ type: 'tg', val: `tg:${tgId}` });
  if (u.oauth_provider && u.oauth_subject) recordList.push({ type: 'oauth', val: `oauth:${u.oauth_provider}:${u.oauth_subject}` });
  if (u.email) recordList.push({ type: 'email', val: `email:${u.email.toLowerCase().trim()}` });

  for (const item of recordList) {
    try {
      d.prepare(`
        INSERT INTO identity_gift_ledger (identifier_type, identifier_val, trial_granted, tg_gift_granted, last_user_id)
        VALUES (?, ?, 1, 1, ?)
        ON CONFLICT(identifier_val) DO UPDATE SET
          tg_gift_granted = 1,
          last_user_id = excluded.last_user_id,
          last_claimed_at = datetime('now')
      `).run(item.type, item.val, userId);
    } catch (_) {}
  }

  // 若此前因流量为 0 或超限被冻结，自动解冻
  if (u.is_frozen && u.freeze_reason === 'traffic_limit') {
    unfreezeUser(userId);
  }

  return { granted: true, alreadyClaimed: false, bytes: giftBytes };
}

// 级联删除用户及其关联数据（与后台删除按钮一致）
function deleteUserCascade(id) {
  const d = _getDb();

  // 在删除前，先确保该用户的身份标识和申领状态记录在 identity_gift_ledger 中，防止删号后丢失
  try {
    const u = d.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (u) {
      const keys = [];
      if (u.telegram_id) keys.push({ type: 'tg', val: `tg:${u.telegram_id}` });
      if (u.oauth_provider && u.oauth_subject) keys.push({ type: 'oauth', val: `oauth:${u.oauth_provider}:${u.oauth_subject}` });
      if (u.email) keys.push({ type: 'email', val: `email:${u.email.toLowerCase().trim()}` });
      const hasTgGift = (u.telegram_id && (u.traffic_limit || 0) > 0) ? 1 : 0;
      for (const k of keys) {
        d.prepare(`
          INSERT INTO identity_gift_ledger (identifier_type, identifier_val, trial_granted, tg_gift_granted, last_user_id)
          VALUES (?, ?, 1, ?, ?)
          ON CONFLICT(identifier_val) DO UPDATE SET
            trial_granted = 1,
            tg_gift_granted = MAX(identity_gift_ledger.tg_gift_granted, excluded.tg_gift_granted),
            last_user_id = excluded.last_user_id,
            last_claimed_at = datetime('now')
        `).run(k.type, k.val, hasTgGift, id);
      }
    }
  } catch (_) {}

  const tx = d.transaction(() => {
    d.prepare('DELETE FROM audit_log WHERE user_id = ?').run(id);
    d.prepare('DELETE FROM sub_access_log WHERE user_id = ?').run(id);
    d.prepare('DELETE FROM sub_access_event WHERE user_id = ?').run(id);
    d.prepare('DELETE FROM user_multi_node_observe_event WHERE user_id = ?').run(id);
    d.prepare('DELETE FROM user_node_uuid WHERE user_id = ?').run(id);
    d.prepare('DELETE FROM traffic WHERE user_id = ?').run(id);
    d.prepare('DELETE FROM traffic_daily WHERE user_id = ?').run(id);
    d.prepare('DELETE FROM traffic_user_total WHERE user_id = ?').run(id);
    for (const t of ['tg_checkin', 'tg_farm_plots', 'tg_farm_seeds']) {
      try { d.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id); } catch (_) { /* 表不存在则忽略 */ }
    }
    try { d.prepare('DELETE FROM tg_farm_steals WHERE thief_id = ? OR victim_id = ?').run(id, id); } catch (_) { /* 表不存在则忽略 */ }
    d.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
  tx();
}

// 返回应删除的「未绑定 TG 超期」非管理员用户。
// 统一规则：从【政策起始时间】与【注册时间】两者较晚者起算 graceDays 天；未到期或政策起始未满 graceDays 则返回空。
function getUnboundUsersForDeletion(graceDays, policyStartMs) {
  const cutoffMs = Date.now() - graceDays * 86400000;
  // 政策起始本身未满 graceDays，则全员仍在缓冲期，不删除任何账号
  if (!Number.isFinite(policyStartMs) || policyStartMs > cutoffMs) return [];
  const cutoffSql = new Date(cutoffMs).toISOString().slice(0, 19).replace('T', ' '); // UTC 'YYYY-MM-DD HH:MM:SS'
  return _getDb().prepare(`
    SELECT id, username FROM users
    WHERE is_admin = 0
      AND (telegram_id IS NULL OR telegram_id = '')
      AND created_at <= ?
  `).all(cutoffSql);
}

function getAllUsers() {
  return _getDb().prepare(`
    SELECT u.*,
      COALESCE(tut.total_up, 0) + COALESCE(tut.total_down, 0) as total_traffic,
      COALESCE(tut.free_bytes, 0) as free_bytes
    FROM users u
    LEFT JOIN traffic_user_total tut ON u.id = tut.user_id
    ORDER BY total_traffic DESC
  `).all();
}

// 转义 SQLite LIKE 模式中的特殊字符，防止用户输入的 % 或 _ 被解释为通配符
function escapeLikePattern(s) {
  return String(s == null ? '' : s).replace(/[\\%_]/g, '\\$&');
}

function getAllUsersPaged(limit = 20, offset = 0, search = '', sortBy = 'total_traffic', sortDir = 'DESC') {
  const escSearch = escapeLikePattern(search);
  const where = search ? "WHERE (u.username LIKE '%' || @search || '%' ESCAPE '\\' OR u.name LIKE '%' || @search || '%' ESCAPE '\\')" : '';
  const allowedSorts = {
    id: 'u.id', username: 'u.username', trust_level: 'u.trust_level',
    total_traffic: 'total_traffic', expires_at: 'u.expires_at', last_login: 'u.last_login'
  };
  const orderCol = allowedSorts[sortBy] || 'total_traffic';
  const dir = sortDir === 'ASC' ? 'ASC' : 'DESC';
  const rows = _getDb().prepare(`
    SELECT u.*,
      COALESCE(tut.total_up, 0) + COALESCE(tut.total_down, 0) as total_traffic,
      COALESCE(tut.free_bytes, 0) as free_bytes
    FROM users u
    LEFT JOIN traffic_user_total tut ON u.id = tut.user_id
    ${where}
    ORDER BY ${orderCol} ${dir}
    LIMIT @limit OFFSET @offset
  `).all({ limit, offset, search: escSearch });
  const total = _getDb().prepare(`SELECT COUNT(*) as c FROM users u ${where}`).get({ search: escSearch }).c;
  return { rows, total };
}

function blockUser(id, blocked) {
  _getDb().prepare('UPDATE users SET is_blocked = ? WHERE id = ?').run(blocked ? 1 : 0, id);
}

function setUserTrafficLimit(id, limitBytes) {
  _getDb().prepare('UPDATE users SET traffic_limit = ? WHERE id = ?').run(limitBytes, id);
}

function isTrafficExceeded(userId) {
  const user = getUserById(userId);
  if (!user) return false;
  if (user.traffic_limit < 0) return false; // 负数表示无限配额
  const traffic = _getDb().prepare(
    'SELECT COALESCE(total_up, 0) + COALESCE(total_down, 0) - COALESCE(free_bytes, 0) as billed FROM traffic_user_total WHERE user_id = ?'
  ).get(userId);
  return Math.max(0, traffic?.billed || 0) >= user.traffic_limit;
}

function freezeUser(id, reason = 'manual') {
  // 仅标记 is_frozen = 1（getNodeAllUserUuids 已过滤 u.is_frozen = 0，同步节点时会自动移除该用户）
  // 不删除 user_node_uuid，避免解冻后 UUID 全部重新生成导致用户原有订阅节点失效
  _getDb().prepare('UPDATE users SET is_frozen = 1, freeze_reason = ? WHERE id = ?').run(reason, id);
}

function unfreezeUser(id) {
  const result = _getDb().prepare('UPDATE users SET is_frozen = 0, freeze_reason = NULL WHERE id = ?').run(id);
  if (result.changes > 0) {
    _ensureUserHasAllNodeUuids(id);
  }
}

// 获取即将因未签到被删除的预警用户列表（默认 29 天未签到，即 30 天规则的前 1 天）
function getNoCheckinUsersForWarning(days = 30) {
  if (days <= 1) return [];
  const warnDays = days - 1;
  const deleteCutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const warnCutoff = new Date(Date.now() - warnDays * 86400000).toISOString().slice(0, 10);

  const users = _getDb().prepare(`
    SELECT u.id, u.username, u.telegram_id, u.created_at,
      (SELECT MAX(date) FROM tg_checkin WHERE user_id = u.id) AS last_checkin
    FROM users u
    WHERE u.is_admin = 0
      AND u.telegram_id IS NOT NULL
      AND u.telegram_id != ''
  `).all().filter(u => {
    const baseDate = u.last_checkin || String(u.created_at || '').slice(0, 10);
    return baseDate && baseDate >= deleteCutoff && baseDate <= warnCutoff;
  });

  const checkLogStmt = _getDb().prepare(`
    SELECT 1 FROM audit_log
    WHERE user_id = ?
      AND action = 'warn_no_checkin'
      AND created_at >= datetime('now', '-7 days')
    LIMIT 1
  `);

  return users.filter(u => !checkLogStmt.get(u.id));
}

// 删除超过 days 天未在 TG 签到的已绑定 TG 用户（从未签到的按注册日期起算；未绑定 TG 的用户跳过）
function autoDeleteNoCheckinUsers(days = 30) {
  const cutoffDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const users = _getDb().prepare(`
    SELECT u.id, u.username, u.created_at,
      (SELECT MAX(date) FROM tg_checkin WHERE user_id = u.id) AS last_checkin
    FROM users u
    WHERE u.is_admin = 0
      AND u.telegram_id IS NOT NULL
      AND u.telegram_id != ''
  `).all().filter(u => {
    const baseDate = u.last_checkin || String(u.created_at || '').slice(0, 10);
    return baseDate && baseDate < cutoffDate;
  });
  const deleted = [];
  for (const u of users) {
    try {
      deleteUserCascade(u.id);
      deleted.push(u);
    } catch (_) { /* 单用户删除失败不中断批次 */ }
  }
  return deleted;
}

const autoFreezeNoCheckinUsers = autoDeleteNoCheckinUsers;

function resetSubToken(userId) {
  const newToken = genSubToken();
  _getDb().prepare('UPDATE users SET sub_token = ? WHERE id = ?').run(newToken, userId);
  return newToken;
}

// Sprint 6: 用户到期时间
function setUserExpiry(userId, expiresAt) {
  _getDb().prepare('UPDATE users SET expires_at = ? WHERE id = ?').run(expiresAt || null, userId);
}

function autoFreezeExpiredUsers() {
  const now = toSqlUtc();
  const users = _getDb().prepare(
    "SELECT id, username FROM users WHERE is_frozen = 0 AND is_blocked = 0 AND is_admin = 0 AND expires_at IS NOT NULL AND expires_at < ?"
  ).all(now);
  for (const u of users) {
    freezeUser(u.id, 'expired');
  }
  return users;
}

function unbindTelegram(userId) {
  _getDb().prepare('UPDATE users SET telegram_id = NULL WHERE id = ?').run(userId);
}

module.exports = {
  init,
  getUserBySubToken, getUserById, getUsersByIds, getUserByUsername, getUserByEmail, getUserByOAuth,
  resolveAvailableUsername,
  createEmailUser, createInvitedEmailUser, createOAuthUser, getUserCount, getTgBoundUserCount,
  grantTgBindGift, deleteUserCascade, getUnboundUsersForDeletion,
  getAllUsers, getAllUsersPaged, blockUser, setUserTrafficLimit,
  isTrafficExceeded, freezeUser, unfreezeUser, autoFreezeNoCheckinUsers, autoDeleteNoCheckinUsers, getNoCheckinUsersForWarning, resetSubToken,
  setUserExpiry, autoFreezeExpiredUsers, unbindTelegram
};
