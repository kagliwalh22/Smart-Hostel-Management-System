const express = require('express');
const db = require('../db');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
const TIERS = ['Single Sitter', 'Double Sharing', 'Triple Sharing'];

// FR-3: Student submits hostel application (BR-2: one per academic year)
router.post('/', verifyToken, requireRole('Student'), async (req, res) => {
  try {
    const { academic_year, preference } = req.body;
    if (!academic_year || !preference) {
      return res.status(400).json({ error: 'Academic year and room preference are required' });
    }
    const m = /^(\d{4})-(\d{4})$/.exec(academic_year);
    if (!m || Number(m[2]) !== Number(m[1]) + 1) {
      return res.status(400).json({ error: 'Academic year must look like 2026-2027' });
    }
    if (!TIERS.includes(preference)) {
      return res.status(400).json({ error: 'Invalid room preference' });
    }
    const [st] = await db.query('SELECT student_id FROM students WHERE user_id = ?', [req.user.user_id]);
    if (!st.length) return res.status(400).json({ error: 'Student profile not found' });
    const sid = st[0].student_id;

    const [dup] = await db.query(
      'SELECT app_id FROM applications WHERE student_id = ? AND academic_year = ?',
      [sid, academic_year]
    );
    if (dup.length) {
      return res.status(409).json({ error: 'You have already applied for ' + academic_year });
    }
    await db.query(
      'INSERT INTO applications (student_id, academic_year, preference) VALUES (?, ?, ?)',
      [sid, academic_year, preference]
    );
    res.status(201).json({ message: 'Application submitted' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'You have already applied for this academic year' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Student sees own applications
router.get('/mine', verifyToken, requireRole('Student'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT a.app_id, a.academic_year, a.preference, a.status
       FROM applications a JOIN students s ON s.student_id = a.student_id
       WHERE s.user_id = ? ORDER BY a.app_id DESC`,
      [req.user.user_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
