const express = require('express');
const db = require('../db');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
const TIERS = ['Single Sitter', 'Double Sharing', 'Triple Sharing'];

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// FR-12: Student requests a transfer (BR-6: only after an allocation exists)
router.post('/', verifyToken, requireRole('Student'), async (req, res) => {
  try {
    const { preferred_tier, reason } = req.body;
    if (!TIERS.includes(preferred_tier)) {
      return res.status(400).json({ error: 'Choose a valid room type' });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Please give a reason' });
    }
    const [st] = await db.query('SELECT student_id FROM students WHERE user_id = ?', [req.user.user_id]);
    if (!st.length) return res.status(400).json({ error: 'Student profile not found' });
    const sid = st[0].student_id;

    const [alloc] = await db.query('SELECT room_id FROM allocations WHERE student_id = ?', [sid]);
    if (!alloc.length) {
      return res.status(400).json({ error: 'Migration is allowed only after a room has been allocated to you' });
    }
    const [open] = await db.query(
      "SELECT req_id FROM migration_requests WHERE student_id = ? AND status = 'Pending'", [sid]
    );
    if (open.length) {
      return res.status(409).json({ error: 'You already have a pending migration request' });
    }
    await db.query(
      'INSERT INTO migration_requests (student_id, current_room_id, preferred_tier, reason) VALUES (?, ?, ?, ?)',
      [sid, alloc[0].room_id, preferred_tier, reason.trim()]
    );
    res.status(201).json({ message: 'Migration request submitted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Student: my requests
router.get('/mine', verifyToken, requireRole('Student'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT m.req_id, r.room_no AS current_room, m.preferred_tier, m.reason, m.status, m.created_at
       FROM migration_requests m
       JOIN students s ON s.student_id = m.student_id
       JOIN rooms r ON r.room_id = m.current_room_id
       WHERE s.user_id = ? ORDER BY m.req_id DESC`,
      [req.user.user_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Warden: pending requests
router.get('/pending', verifyToken, requireRole('Warden'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT m.req_id, m.student_id, u.name, r.room_no AS current_room, m.preferred_tier, m.reason
       FROM migration_requests m
       JOIN students s ON s.student_id = m.student_id
       JOIN users u ON u.user_id = s.user_id
       JOIN rooms r ON r.room_id = m.current_room_id
       WHERE m.status = 'Pending' ORDER BY m.req_id`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Warden: approve and move the student (atomic)
router.post('/:id/approve', verifyToken, requireRole('Warden'), async (req, res) => {
  const room_id = Number(req.body.room_id);
  if (!room_id) return res.status(400).json({ error: 'Choose a target room' });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [reqs] = await conn.query('SELECT * FROM migration_requests WHERE req_id = ? FOR UPDATE', [req.params.id]);
    if (!reqs.length) throw fail(404, 'Request not found');
    const mr = reqs[0];
    if (mr.status !== 'Pending') throw fail(400, 'This request is already processed');

    // BR-6: an allocation must exist
    const [allocs] = await conn.query('SELECT * FROM allocations WHERE student_id = ? FOR UPDATE', [mr.student_id]);
    if (!allocs.length) throw fail(400, 'Student has no allocated room');
    const alloc = allocs[0];
    if (room_id === alloc.room_id) throw fail(400, 'Student is already in this room');

    // lock both rooms in a fixed order to avoid deadlocks
    const [rooms] = await conn.query(
      'SELECT * FROM rooms WHERE room_id IN (?, ?) ORDER BY room_id FOR UPDATE',
      [alloc.room_id, room_id]
    );
    const target = rooms.find(r => r.room_id === room_id);
    if (!target) throw fail(404, 'Target room not found');
    if (target.occupied >= target.capacity) throw fail(409, 'Room ' + target.room_no + ' is full');
    if (target.tier !== mr.preferred_tier) {
      throw fail(400, 'Room tier (' + target.tier + ') does not match requested type (' + mr.preferred_tier + ')');
    }

    await conn.query('UPDATE rooms SET occupied = occupied - 1 WHERE room_id = ?', [alloc.room_id]);
    await conn.query('UPDATE rooms SET occupied = occupied + 1 WHERE room_id = ?', [room_id]);
    await conn.query(
      'UPDATE allocations SET room_id = ?, warden_id = ?, allocated_date = CURDATE() WHERE alloc_id = ?',
      [room_id, req.user.user_id, alloc.alloc_id]
    );
    await conn.query(
      "UPDATE migration_requests SET status = 'Approved', warden_id = ? WHERE req_id = ?",
      [req.user.user_id, mr.req_id]
    );
    await conn.commit();
    res.json({ message: mr.student_id + ' moved to room ' + target.room_no });
  } catch (err) {
    await conn.rollback();
    if (err.status) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// Warden: reject
router.post('/:id/reject', verifyToken, requireRole('Warden'), async (req, res) => {
  try {
    const [r] = await db.query(
      "UPDATE migration_requests SET status = 'Rejected', warden_id = ? WHERE req_id = ? AND status = 'Pending'",
      [req.user.user_id, req.params.id]
    );
    if (!r.affectedRows) return res.status(400).json({ error: 'Request not found or already processed' });
    res.json({ message: 'Request rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
