const express = require('express');
const db = require('../db');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
const CATEGORIES = ['Plumbing', 'Electrical', 'Cleaning', 'Furniture', 'Internet', 'Other'];
// BR-12: only these three states, moving forward one step at a time
const NEXT = { 'Open': 'In Progress', 'In Progress': 'Resolved' };

// FR-6: Student raises a complaint (status starts as Open)
router.post('/', verifyToken, requireRole('Student'), async (req, res) => {
  try {
    const { category, title, description } = req.body;
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Choose a valid category' });
    if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
    if (!description || !description.trim()) return res.status(400).json({ error: 'Description is required' });
    const [st] = await db.query('SELECT student_id FROM students WHERE user_id = ?', [req.user.user_id]);
    if (!st.length) return res.status(400).json({ error: 'Student profile not found' });
    await db.query(
      "INSERT INTO complaints (student_id, category, title, description, status) VALUES (?, ?, ?, ?, 'Open')",
      [st[0].student_id, category, title.trim(), description.trim()]
    );
    res.status(201).json({ message: 'Complaint registered with status Open' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Student: my complaints
router.get('/mine', verifyToken, requireRole('Student'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.complaint_id, c.category, c.title, c.status, c.created_at, c.resolved_at
       FROM complaints c JOIN students s ON s.student_id = c.student_id
       WHERE s.user_id = ? ORDER BY c.complaint_id DESC`,
      [req.user.user_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Warden: all complaints
router.get('/', verifyToken, requireRole('Warden'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.complaint_id, c.student_id, u.name, c.category, c.title, c.description, c.status, c.created_at, c.resolved_at
       FROM complaints c
       JOIN students s ON s.student_id = c.student_id
       JOIN users u ON u.user_id = s.user_id
       ORDER BY FIELD(c.status, 'Open', 'In Progress', 'Resolved'), c.complaint_id`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Warden: move status Open -> In Progress -> Resolved
router.put('/:id/status', verifyToken, requireRole('Warden'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['Open', 'In Progress', 'Resolved'].includes(status)) {
      return res.status(400).json({ error: 'Status must be Open, In Progress or Resolved' });
    }
    const [rows] = await db.query('SELECT status FROM complaints WHERE complaint_id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Complaint not found' });
    const current = rows[0].status;
    if (NEXT[current] !== status) {
      return res.status(400).json({ error: 'Cannot change from ' + current + ' to ' + status });
    }
    const [r] = await db.query(
      `UPDATE complaints SET status = ?, resolved_at = IF(? = 'Resolved', NOW(), NULL)
       WHERE complaint_id = ? AND status = ?`,
      [status, status, req.params.id, current]
    );
    if (!r.affectedRows) return res.status(409).json({ error: 'Complaint was updated by someone else, refresh' });
    res.json({ message: 'Status changed to ' + status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
