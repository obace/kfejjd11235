const crypto = require('crypto');
const { toSqlUtc } = require('../../utils/time');

let _getDb;
let _getUserById;
let _getSetting;
let _addAuditLog;

function init(deps) {
  _getDb = deps.getDb;
  _getUserById = deps.getUserById;
  _getSetting = deps.getSetting;
  _addAuditLog = deps.addAuditLog;
}

function generateInviteCodeValue() {
  return crypto.randomBytes(6).toString('base64url').toUpperCase();
}

function cleanupExpiredInviteCodes() {
  const d = _getDb();
  const expired = d.prepare(`
    DELETE FROM invite_codes
    WHERE used_at IS NULL
      AND expires_at <= datetime('now')
  `).run();
  return { deletedExpired: expired.changes };
}

function getLatestInviteCodeByUser(userId) {
  return _getDb().prepare(`
    SELECT *
    FROM invite_codes
    WHERE inviter_user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId) || null;
}

function getActiveInviteCodeByUser(userId) {
  return _getDb().prepare(`
    SELECT *
    FROM invite_codes
    WHERE inviter_user_id = ?
      AND used_at IS NULL
      AND expires_at > datetime('now')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId) || null;
}

function getInviteGenerateStatusByUser(userId, isAdmin = false) {
  const latest = getLatestInviteCodeByUser(userId);
  const activeInvite = getActiveInviteCodeByUser(userId);
  if (!latest) {
    return {
      activeInvite: null,
      latestInvite: null,
      canGenerate: true,
      nextGenerateAt: null,
    };
  }

  if (isAdmin) {
    return {
      activeInvite,
      latestInvite: latest,
      canGenerate: true,
      nextGenerateAt: null,
    };
  }

  const createdAtMs = new Date(`${String(latest.created_at).replace(' ', 'T')}Z`).getTime();
  const nextGenerateAt = Number.isFinite(createdAtMs)
    ? toSqlUtc(new Date(createdAtMs + INVITE_CODE_TTL_MS))
    : null;
  const canGenerate = !nextGenerateAt || (Date.now() >= new Date(`${nextGenerateAt.replace(' ', 'T')}Z`).getTime());
  return {
    activeInvite,
    latestInvite: latest,
    canGenerate,
    nextGenerateAt,
  };
}

function getUsableInviteCode(code) {
  const value = String(code || '').trim().toUpperCase();
  if (!value) return null;
  return _getDb().prepare(`
    SELECT *
    FROM invite_codes
    WHERE code = ?
      AND used_at IS NULL
      AND expires_at > datetime('now')
    LIMIT 1
  `).get(value) || null;
}


function generateInviteCodeForUser(userId, isAdmin = false) {
  const d = _getDb();
  const latest = getLatestInviteCodeByUser(userId);
  const now = Date.now();

  if (!isAdmin && latest) {
    const createdAtMs = new Date(`${String(latest.created_at).replace(' ', 'T')}Z`).getTime();
    if (Number.isFinite(createdAtMs) && (now - createdAtMs) < INVITE_CODE_TTL_MS) {
      const activeInvite = latest.used_at ? null : getActiveInviteCodeByUser(userId);
      return {
        ok: false,
        reason: 'daily_limit',
        invite: activeInvite || latest,
        nextGenerateAt: toSqlUtc(new Date(createdAtMs + INVITE_CODE_TTL_MS)),
      };
    }
  }

  let code = '';
  let generated = false;
  let attempts = 0;
  while (attempts < 5) {
    code = generateInviteCodeValue();
    const exists = d.prepare('SELECT 1 FROM invite_codes WHERE code = ? LIMIT 1').get(code);
    if (!exists) {
      generated = true;
      break;
    }
    attempts++;
  }
  if (!generated) {
    throw new Error('failed to generate invite code');
  }

  const expiresAt = isAdmin ? '9999-12-31 23:59:59' : toSqlUtc(new Date(now + INVITE_CODE_TTL_MS));
  d.prepare(`
    INSERT INTO invite_codes (inviter_user_id, code, expires_at)
    VALUES (?, ?, ?)
  `).run(userId, code, expiresAt);

  return {
    ok: true,
    invite: getActiveInviteCodeByUser(userId),
    nextGenerateAt: isAdmin ? null : expiresAt,
  };
}


module.exports = {
  init,
  cleanupExpiredInviteCodes,
  getInviteGenerateStatusByUser,
  getUsableInviteCode,
  generateInviteCodeForUser,
};
