const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// FR-2 Registration (BR-1: unique Student ID)
router.post('/register', async (req, res) => {
  const { student_id, name, email, password, phone, emergency_phone } = req.body;
  if (!student_id || !name || !email || !password) {
    return res.status(400).json({ error: 'Student ID, name, email and password are required' });
  }
  const sid = student_id.toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(sid)) {
    return res.status(400).json({ error: 'Student ID must be 4-12 letters or digits' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if ((phone && !/^\d{10}$/.test(phone)) || (emergency_phone && !/^\d{10}$/.test(emergency_phone))) {
    return res.status(400).json({ error: 'Phone numbers must be 10 digits' });
  }
  const conn = await db.getConnection();
  try {
    const [dup] = await conn.query('SELECT student_id FROM students WHERE student_id = ?', [sid]);
    if (dup.length) return res.status(409).json({ error: 'This Student ID is already registered' });
    await conn.beginTransaction();
    const hash = await bcrypt.hash(password, 10);
    const [r] = await conn.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'Student')",
      [name, email, hash]
    );
    await conn.query(
      'INSERT INTO students (student_id, user_id, phone, emergency_phone) VALUES (?, ?, ?, ?)',
      [sid, r.insertId, phone || null, emergency_phone || null]
    );
    await conn.commit();
    res.status(201).json({ message: 'Registered' });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Student ID or email already registered' });
    }
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// FR-7 Profile view
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.user_id, u.name, u.email, u.role, s.student_id, s.phone, s.emergency_phone
       FROM users u LEFT JOIN students s ON s.user_id = u.user_id WHERE u.user_id = ?`,
      [req.user.user_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// FR-7 Profile edit
router.put('/profile', verifyToken, async (req, res) => {
  try {
    const { name, phone, emergency_phone } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if ((phone && !/^\d{10}$/.test(phone)) || (emergency_phone && !/^\d{10}$/.test(emergency_phone))) {
      return res.status(400).json({ error: 'Phone numbers must be 10 digits' });
    }
    await db.query('UPDATE users SET name = ? WHERE user_id = ?', [name, req.user.user_id]);
    if (req.user.role === 'Student') {
      await db.query(
        'UPDATE students SET phone = ?, emergency_phone = ? WHERE user_id = ?',
        [phone || null, emergency_phone || null, req.user.user_id]
      );
    }
    res.json({ message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
