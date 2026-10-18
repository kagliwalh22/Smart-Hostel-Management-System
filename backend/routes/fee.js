const express = require('express');
const db = require('../db');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const FEE_SELECT = `
  SELECT f.fee_id, f.student_id, u.name, f.amount,
         DATE_FORMAT(f.due_date, '%Y-%m-%d') AS due_date, f.status
  FROM fee_ledger f
  JOIN students s ON s.student_id = f.student_id
  JOIN users u ON u.user_id = s.user_id`;

// Admin: students list for the dropdown
router.get('/students', verifyToken, requireRole('Admin'), async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT s.student_id, u.name FROM students s JOIN users u ON u.user_id = s.user_id ORDER BY u.name'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Student: own fee records (read only)
router.get('/mine', verifyToken, requireRole('Student'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT f.fee_id, f.amount, DATE_FORMAT(f.due_date, '%Y-%m-%d') AS due_date, f.status
       FROM fee_ledger f JOIN students s ON s.student_id = f.student_id
       WHERE s.user_id = ? ORDER BY f.due_date DESC`,
      [req.user.user_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// BR-7: only Admin may view / create / edit the fee ledger
router.get('/', verifyToken, requireRole('Admin'), async (req, res) => {
  try {
    const [rows] = await db.query(FEE_SELECT + ' ORDER BY f.due_date, f.fee_id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', verifyToken, requireRole('Admin'), async (req, res) => {
  try {
    const { student_id, amount, due_date } = req.body;
    if (!student_id) return res.status(400).json({ error: 'Choose a student' });
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });
    if (!DATE_RE.test(due_date || '')) return res.status(400).json({ error: 'Choose a valid due date' });
    const [st] = await db.query('SELECT student_id FROM students WHERE student_id = ?', [student_id]);
    if (!st.length) return res.status(404).json({ error: 'Student not found' });
    await db.query(
      "INSERT INTO fee_ledger (student_id, amount, due_date, status) VALUES (?, ?, ?, 'Pending')",
      [student_id, amt, due_date]
    );
    res.status(201).json({ message: 'Fee record added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// FR-5: Admin updates payment status
router.put('/:id/status', verifyToken, requireRole('Admin'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['Pending', 'Paid'].includes(status)) {
      return res.status(400).json({ error: 'Status must be Pending or Paid' });
    }
    const [r] = await db.query('UPDATE fee_ledger SET status = ? WHERE fee_id = ?', [status, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Fee record not found' });
    res.json({ message: 'Fee marked ' + status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
