/**
 * SQLite 数据库自动备份服务
 * 备份到 /root/panel/backups/，只保留最新 1 个备份
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const BACKUP_DIR = path.join(__dirname, '..', '..', 'backups');
const MAX_BACKUPS = 1;

/**
 * 执行一次备份（使用 better-sqlite3 的 backup API）
 */
async function performBackup(db) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  // 确保目录权限（mkdirSync 在已存在时不会更新权限）
  try { fs.chmodSync(BACKUP_DIR, 0o700); } catch (_) { /* 忽略 */ }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `panel-${timestamp}.db`);

  try {
    await db.backup(backupPath);
    // 设置 0600 仅 root 可读写，防止备份文件被同主机其他用户读取
    try { fs.chmodSync(backupPath, 0o600); } catch (_) { /* 忽略 */ }
    logger.info({ backupPath }, '数据库备份完成');
    cleanOldBackups();
    return { ok: true, backupPath };
  } catch (err) {
    logger.error({ err, backupPath }, '数据库备份失败');
    return { ok: false, error: err.message || '数据库备份失败' };
  }
}

/**
 * 清理旧备份文件，只保留最新的 MAX_BACKUPS 个备份
 */
function cleanOldBackups() {
  try {
    const entries = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('panel-') && f.endsWith('.db'))
      .map(file => {
        const filePath = path.join(BACKUP_DIR, file);
        const stat = fs.statSync(filePath);
        return { file, filePath, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file));

    for (const item of entries.slice(MAX_BACKUPS)) {
      fs.unlinkSync(item.filePath);
      logger.info({ file: item.file }, '清理旧备份');
    }
  } catch (err) {
    logger.error({ err }, '清理备份失败');
  }
}

module.exports = { performBackup, BACKUP_DIR };
