const express = require('express');
const db = require('../db');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Warden: pending applications
router.get('/pending', verifyToken, requireRole('Warden'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT a.app_id, a.student_id, u.name, a.academic_year, a.preference
       FROM applications a
       JOIN students s ON s.student_id = a.student_id
       JOIN users u ON u.user_id = s.user_id
       WHERE a.status = 'Pending' ORDER BY a.app_id`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Warden: real-time room capacity matrix
router.get('/rooms', verifyToken, requireRole('Warden'), async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT room_id, room_no, tier, capacity, occupied, (capacity - occupied) AS vacancy FROM rooms ORDER BY room_no'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// FR-4: Warden confirms allocation (BR-4 Warden only, BR-5 one room per student)
router.post('/', verifyToken, requireRole('Warden'), async (req, res) => {
  const { app_id, room_id } = req.body;
  if (!app_id || !room_id) {
    return res.status(400).json({ error: 'Application and room are required' });
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [apps] = await conn.query('SELECT * FROM applications WHERE app_id = ? FOR UPDATE', [app_id]);
    if (!apps.length) throw fail(404, 'Application not found');
    const app = apps[0];
    if (app.status !== 'Pending') throw fail(400, 'This application is already processed');

    // BR-5: student cannot hold more than one room
    const [held] = await conn.query('SELECT alloc_id FROM allocations WHERE student_id = ?', [app.student_id]);
    if (held.length) throw fail(409, 'Student already has a room');

    // Atomic vacancy check: lock the room row
    const [rooms] = await conn.query('SELECT * FROM rooms WHERE room_id = ? FOR UPDATE', [room_id]);
    if (!rooms.length) throw fail(404, 'Room not found');
    const room = rooms[0];
    if (room.occupied >= room.capacity) throw fail(409, 'Room ' + room.room_no + ' is full');
    if (room.tier !== app.preference) {
      throw fail(400, 'Room tier (' + room.tier + ') does not match preference (' + app.preference + ')');
    }

    await conn.query(
      'INSERT INTO allocations (student_id, room_id, warden_id, allocated_date) VALUES (?, ?, ?, CURDATE())',
      [app.student_id, room_id, req.user.user_id]
    );
    await conn.query('UPDATE rooms SET occupied = occupied + 1 WHERE room_id = ?', [room_id]);
    await conn.query("UPDATE applications SET status = 'Allocated' WHERE app_id = ?", [app_id]);

    await conn.commit();
    res.status(201).json({ message: 'Room ' + room.room_no + ' allocated to ' + app.student_id });
  } catch (err) {
    await conn.rollback();
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Student already has a room' });
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// Student: my allocated room
router.get('/mine', verifyToken, requireRole('Student'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.room_no, r.tier, DATE_FORMAT(al.allocated_date, '%Y-%m-%d') AS allocated_date
       FROM allocations al
       JOIN students s ON s.student_id = al.student_id
       JOIN rooms r ON r.room_id = al.room_id
       WHERE s.user_id = ?`,
      [req.user.user_id]
    );
    res.json(rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
