const express = require('express');
const db = require('../db');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// BR-8: roll call register works only between 9:00 PM and 9:30 PM.
// ATTENDANCE_OVERRIDE=true in .env opens it for demos.
function windowState() {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const inWindow = mins >= 21 * 60 && mins < 21 * 60 + 30;
  const override = process.env.ATTENDANCE_OVERRIDE === 'true';
  return { inWindow, override, open: inWindow || override, time: now.toTimeString().slice(0, 8) };
}

const ROSTER_SQL = `
  SELECT s.student_id, u.name, r.room_no
  FROM allocations al
  JOIN students s ON s.student_id = al.student_id
  JOIN users u ON u.user_id = s.user_id
  JOIN rooms r ON r.room_id = al.room_id
  ORDER BY r.room_no, u.name`;

// Warden: roster for today (or the locked record if already submitted)
router.get('/roster', verifyToken, requireRole('Warden'), async (req, res) => {
  try {
    const w = windowState();
    const [students] = await db.query(ROSTER_SQL);
    const [saved] = await db.query(
      'SELECT student_id, status, remark FROM attendance WHERE att_date = CURDATE()'
    );
    const byId = {};
    saved.forEach(a => { byId[a.student_id] = a; });
    res.json({
      server_time: w.time,
      window_open: w.inWindow,
      override: w.override,
      submitted: saved.length > 0,
      students: students.map(s => ({
        ...s,
        status: byId[s.student_id] ? byId[s.student_id].status : null,
        remark: byId[s.student_id] ? byId[s.student_id].remark : null,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// FR-9: Warden submits attendance, record is locked afterwards
router.post('/', verifyToken, requireRole('Warden'), async (req, res) => {
  const w = windowState();
  if (!w.open) {
    return res.status(403).json({
      error: 'Attendance register is open only between 9:00 PM and 9:30 PM (server time ' + w.time + ')',
    });
  }
  const { records } = req.body;
  if (!Array.isArray(records) || !records.length) {
    return res.status(400).json({ error: 'No attendance records sent' });
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [done] = await conn.query('SELECT COUNT(*) AS c FROM attendance WHERE att_date = CURDATE() FOR UPDATE');
    if (done[0].c > 0) throw fail(409, "Today's attendance is already submitted and locked");

    const [roster] = await conn.query(ROSTER_SQL);
    const rosterIds = roster.map(r => r.student_id).sort();
    const sentIds = records.map(r => r.student_id).sort();
    if (JSON.stringify(rosterIds) !== JSON.stringify(sentIds)) {
      throw fail(400, 'Attendance must cover every student on the roster exactly once');
    }
    for (const r of records) {
      if (!['Present', 'Absent'].includes(r.status)) throw fail(400, 'Status must be Present or Absent');
      await conn.query(
        'INSERT INTO attendance (student_id, att_date, status, remark, warden_id) VALUES (?, CURDATE(), ?, ?, ?)',
        [r.student_id, r.status, r.status === 'Absent' ? (r.remark || null) : null, req.user.user_id]
      );
    }
    await conn.commit();
    const absent = records.filter(r => r.status === 'Absent').length;
    res.status(201).json({ message: 'Attendance saved and locked. Present: ' + (records.length - absent) + ', Absent: ' + absent });
  } catch (err) {
    await conn.rollback();
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: "Today's attendance is already submitted and locked" });
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// Student: own attendance history
router.get('/mine', verifyToken, requireRole('Student'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT DATE_FORMAT(a.att_date, '%Y-%m-%d') AS att_date, a.status, a.remark
       FROM attendance a JOIN students s ON s.student_id = a.student_id
       WHERE s.user_id = ? ORDER BY a.att_date DESC`,
      [req.user.user_id]
    );
    const present = rows.filter(r => r.status === 'Present').length;
    res.json({
      total: rows.length,
      present,
      absent: rows.length - present,
      percentage: rows.length ? Math.round((present * 100) / rows.length) : 0,
      records: rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
