// NFR: automatic database backup every day at midnight.
// Needs mysqldump (comes with XAMPP). Manual run: node backup.js
const { execFile } = require('child_process');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

function runBackup() {
  const dir = path.join(__dirname, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, 'shms-' + stamp + '.sql');
  const exe = process.env.MYSQLDUMP_PATH || 'C:\\xampp\\mysql\\bin\\mysqldump.exe';
  const args = ['-h', process.env.DB_HOST || 'localhost', '-u', process.env.DB_USER || 'root'];
  if (process.env.DB_PASSWORD) args.push('-p' + process.env.DB_PASSWORD);
  args.push('--result-file=' + file, process.env.DB_NAME || 'shms');
  return new Promise(resolve => {
    execFile(exe, args, err => {
      if (err) { console.error('[backup] failed: ' + err.message); resolve(null); }
      else { console.log('[backup] saved ' + file); resolve(file); }
    });
  });
}

function startBackupJob() {
  cron.schedule('0 0 * * *', runBackup);
  console.log('Daily database backup scheduled for midnight');
}

module.exports = { runBackup, startBackupJob };

if (require.main === module) {
  require('dotenv').config();
  runBackup().then(() => process.exit());
}
