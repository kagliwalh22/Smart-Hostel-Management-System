// FR-13: automatic fee due-date email reminders (BR-7)
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const db = require('./db');

let transporterPromise = null;

// If SMTP_HOST is set in .env a real mail server is used.
// Otherwise a free Ethereal test inbox is created (emails are viewable through a preview link).
function getTransporter() {
  if (!transporterPromise) {
    transporterPromise = (async () => {
      if (process.env.SMTP_HOST) {
        const port = Number(process.env.SMTP_PORT || 587);
        return {
          fake: false,
          t: nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port,
            secure: port === 465,
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
          }),
        };
      }
      const acc = await nodemailer.createTestAccount();
      return {
        fake: true,
        t: nodemailer.createTransport({
          host: acc.smtp.host, port: acc.smtp.port, secure: acc.smtp.secure,
          auth: { user: acc.user, pass: acc.pass },
        }),
      };
    })().catch(err => { transporterPromise = null; throw err; });
  }
  return transporterPromise;
}

async function sendDueReminders() {
  const days = Number(process.env.REMINDER_DAYS || 3);
  const [rows] = await db.query(
    `SELECT f.fee_id, f.amount, DATE_FORMAT(f.due_date, '%Y-%m-%d') AS due_date, u.name, u.email
     FROM fee_ledger f
     JOIN students s ON s.student_id = f.student_id
     JOIN users u ON u.user_id = s.user_id
     WHERE f.status = 'Pending'
       AND f.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)`,
    [days]
  );
  const result = { window_days: days, checked: rows.length, sent: 0, failed: 0, results: [] };
  if (!rows.length) return result;

  const { t, fake } = await getTransporter();
  for (const f of rows) {
    try {
      const info = await t.sendMail({
        from: '"SHMS Hostel Office" <no-reply@shms.local>',
        to: f.email,
        subject: 'Hostel fee reminder: due on ' + f.due_date,
        text: 'Dear ' + f.name + ',\n\nYour hostel fee of ' + f.amount + ' is due on ' + f.due_date +
          '. Please pay before the due date.\n\nRegards,\nSmart Hostel Management System',
      });
      result.sent++;
      result.results.push({ fee_id: f.fee_id, to: f.email, due_date: f.due_date, preview: fake ? nodemailer.getTestMessageUrl(info) : null });
    } catch (err) {
      result.failed++;
      result.results.push({ fee_id: f.fee_id, to: f.email, error: err.message });
    }
  }
  return result;
}

// Runs automatically every day at 9:00 AM server time
function startScheduler() {
  cron.schedule('0 9 * * *', async () => {
    try {
      const r = await sendDueReminders();
      console.log('[cron] Fee reminders: checked ' + r.checked + ', sent ' + r.sent + ', failed ' + r.failed);
    } catch (err) {
      console.error('[cron] Reminder job failed:', err.message);
    }
  });
  console.log('Fee reminder job scheduled for 9:00 AM daily');
}

module.exports = { sendDueReminders, startScheduler };
