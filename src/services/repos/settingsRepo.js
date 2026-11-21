let _getDb;

function init(deps) {
  _getDb = deps.getDb;
}

function addAuditLog(userId, action, detail, ip) {
  _getDb().prepare("INSERT INTO audit_log (user_id, action, detail, ip, created_at) VALUES (?, ?, ?, ?, datetime('now'))").run(userId, action, detail, ip);
}

function getAuditLogs(limit = 50, offset = 0, type = 'all') {
  const where = type === 'system' ? "WHERE a.ip = 'system'" : type === 'user' ? "WHERE a.ip != 'system'" : '';
  const rows = _getDb().prepare(`
    SELECT a.*, u.username FROM audit_log a
    LEFT JOIN users u ON a.user_id = u.id
    ${where}
    ORDER BY a.created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset);
  const total = _getDb().prepare(`SELECT COUNT(*) as c FROM audit_log a ${where}`).get().c;
  return { rows, total };
}

function clearAuditLogs() {
  _getDb().prepare('DELETE FROM audit_log').run();
}

function getSetting(key) {
  const row = _getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  _getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

module.exports = {
  init,
  addAuditLog, getAuditLogs, clearAuditLogs,
  getSetting, setSetting,
};
