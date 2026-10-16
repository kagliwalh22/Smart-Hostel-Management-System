const express = require('express');
const db = require('../db');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// FR-11: Student requests an out-pass
router.post('/', verifyToken, requireRole('Student'), async (req, res) => {
  try {
    const { from_date, to_date, destination, reason } = req.body;
    if (!DATE_RE.test(from_date || '') || !DATE_RE.test(to_date || '')) {
      return res.status(400).json({ error: 'Choose valid from and to dates' });
    }
    if (!destination || !destination.trim()) return res.status(400).json({ error: 'Destination is required' });
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'Reason is required' });

    const [chk] = await db.query(
      'SELECT (? >= CURDATE()) AS not_past, (? >= ?) AS in_order', [from_date, to_date, from_date]
    );
    if (!chk[0].not_past) return res.status(400).json({ error: 'From date cannot be in the past' });
    if (!chk[0].in_order) return res.status(400).json({ error: 'To date cannot be before from date' });

    const [st] = await db.query('SELECT student_id FROM students WHERE user_id = ?', [req.user.user_id]);
    if (!st.length) return res.status(400).json({ error: 'Student profile not found' });
    const sid = st[0].student_id;

    // Pre-condition: active room allocation
    const [alloc] = await db.query('SELECT alloc_id FROM allocations WHERE student_id = ?', [sid]);
    if (!alloc.length) return res.status(400).json({ error: 'You need an allocated room before requesting an out-pass' });

    // Pre-condition: no overlapping pending/approved request
    const [overlap] = await db.query(
      `SELECT pass_id FROM outpasses
       WHERE student_id = ? AND status IN ('Pending','Approved') AND from_date <= ? AND to_date >= ?`,
      [sid, to_date, from_date]
    );
    if (overlap.length) return res.status(409).json({ error: 'You already have an out-pass request for these dates' });

    await db.query(
      'INSERT INTO outpasses (student_id, from_date, to_date, destination, reason) VALUES (?, ?, ?, ?, ?)',
      [sid, from_date, to_date, destination.trim(), reason.trim()]
    );
    res.status(201).json({ message: 'Out-pass request sent to the Warden' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Student: my out-passes
router.get('/mine', verifyToken, requireRole('Student'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT o.pass_id, DATE_FORMAT(o.from_date, '%Y-%m-%d') AS from_date, DATE_FORMAT(o.to_date, '%Y-%m-%d') AS to_date,
              o.destination, o.reason, o.status, DATE_FORMAT(o.decided_at, '%Y-%m-%d %H:%i') AS decided_at
       FROM outpasses o JOIN students s ON s.student_id = o.student_id
       WHERE s.user_id = ? ORDER BY o.pass_id DESC`,
      [req.user.user_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Warden: all out-passes (pending first)
router.get('/', verifyToken, requireRole('Warden'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT o.pass_id, o.student_id, u.name, DATE_FORMAT(o.from_date, '%Y-%m-%d') AS from_date,
              DATE_FORMAT(o.to_date, '%Y-%m-%d') AS to_date, o.destination, o.reason, o.status,
              DATE_FORMAT(o.decided_at, '%Y-%m-%d %H:%i') AS decided_at
       FROM outpasses o
       JOIN students s ON s.student_id = o.student_id
       JOIN users u ON u.user_id = s.user_id
       ORDER BY FIELD(o.status, 'Pending', 'Approved', 'Rejected'), o.pass_id`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Warden: approve or reject. After the decision the record is locked (BR-10)
router.post('/:id/decision', verifyToken, requireRole('Warden'), async (req, res) => {
  try {
    const { decision } = req.body;
    if (!['Approved', 'Rejected'].includes(decision)) {
      return res.status(400).json({ error: 'Decision must be Approved or Rejected' });
    }
    const [r] = await db.query(
      "UPDATE outpasses SET status = ?, warden_id = ?, decided_at = NOW() WHERE pass_id = ? AND status = 'Pending'",
      [decision, req.user.user_id, req.params.id]
    );
    if (!r.affectedRows) {
      return res.status(400).json({ error: 'This out-pass is already decided and locked, or does not exist' });
    }
    res.json({ message: 'Out-pass ' + decision.toLowerCase() + ' (authorized by Warden ID ' + req.user.user_id + ')' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
