const express = require('express');
const db = require('../db');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// BR-11: visitors allowed only between 4:00 PM and 7:00 PM.
// VISITOR_OVERRIDE=true in .env opens it for demos.
function windowState() {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const inWindow = mins >= 16 * 60 && mins < 19 * 60;
  const override = process.env.VISITOR_OVERRIDE === 'true';
  return { inWindow, override, open: inWindow || override, time: now.toTimeString().slice(0, 8) };
}

// Warden: students list for the dropdown
router.get('/students', verifyToken, requireRole('Warden'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT s.student_id, u.name, r.room_no
       FROM students s
       JOIN users u ON u.user_id = s.user_id
       LEFT JOIN allocations al ON al.student_id = s.student_id
       LEFT JOIN rooms r ON r.room_id = al.room_id
       ORDER BY u.name`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Warden: today's visitor log + window status
router.get('/', verifyToken, requireRole('Warden'), async (req, res) => {
  try {
    const w = windowState();
    const [rows] = await db.query(
      `SELECT v.visitor_id, v.student_id, u.name AS student_name, v.visitor_name, v.purpose,
              DATE_FORMAT(v.in_time, '%Y-%m-%d %H:%i') AS in_time, v.warden_signature
       FROM visitors v
       JOIN students s ON s.student_id = v.student_id
       JOIN users u ON u.user_id = s.user_id
       WHERE DATE(v.in_time) = CURDATE()
       ORDER BY v.visitor_id DESC`
    );
    res.json({ server_time: w.time, window_open: w.inWindow, override: w.override, visitors: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// FR-10: Warden logs a visitor with signature (BR-11 time window)
router.post('/', verifyToken, requireRole('Warden'), async (req, res) => {
  try {
    const w = windowState();
    if (!w.open) {
      return res.status(403).json({
        error: 'Visitors are allowed only between 4:00 PM and 7:00 PM (server time ' + w.time + ')',
      });
    }
    const { student_id, visitor_name, purpose, warden_signature } = req.body;
    if (!student_id) return res.status(400).json({ error: 'Choose the student being visited' });
    if (!visitor_name || !visitor_name.trim()) return res.status(400).json({ error: 'Visitor name is required' });
    if (!purpose || !purpose.trim()) return res.status(400).json({ error: 'Purpose of visit is required' });
    if (!warden_signature || !warden_signature.trim()) return res.status(400).json({ error: 'Warden signature is required' });

    const [st] = await db.query('SELECT student_id FROM students WHERE student_id = ?', [student_id]);
    if (!st.length) return res.status(404).json({ error: 'Student not found' });

    await db.query(
      'INSERT INTO visitors (student_id, visitor_name, purpose, warden_signature) VALUES (?, ?, ?, ?)',
      [student_id, visitor_name.trim(), purpose.trim(), warden_signature.trim()]
    );
    res.status(201).json({ message: 'Visitor checked in and logged with timestamp' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
