const express = require('express');
const db = require('../db');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
const TIERS = ['Single Sitter', 'Double Sharing', 'Triple Sharing'];

// FR-8 / BR-13: reports can be generated only by Admin
router.get('/summary', verifyToken, requireRole('Admin'), async (req, res) => {
  try {
    const [occ] = await db.query(
      `SELECT tier, COUNT(*) AS rooms, SUM(capacity) AS capacity, SUM(occupied) AS occupied
       FROM rooms GROUP BY tier`
    );
    const occupancy = TIERS.map(t => {
      const r = occ.find(o => o.tier === t) || {};
      const capacity = Number(r.capacity || 0);
      const occupied = Number(r.occupied || 0);
      return { tier: t, rooms: Number(r.rooms || 0), capacity, occupied, vacant: capacity - occupied };
    });
    const totalCap = occupancy.reduce((a, o) => a + o.capacity, 0);
    const totalOcc = occupancy.reduce((a, o) => a + o.occupied, 0);

    const [cs] = await db.query('SELECT status, COUNT(*) AS c FROM complaints GROUP BY status');
    const complaints = { Open: 0, 'In Progress': 0, Resolved: 0 };
    cs.forEach(c => { complaints[c.status] = Number(c.c); });
    const [avg] = await db.query(
      `SELECT AVG(TIMESTAMPDIFF(MINUTE, created_at, resolved_at)) AS avg_min
       FROM complaints WHERE status = 'Resolved' AND resolved_at IS NOT NULL`
    );
    const avgHours = avg[0].avg_min === null ? null : Math.round((Number(avg[0].avg_min) / 60) * 10) / 10;

    const [fs] = await db.query(
      'SELECT status, COUNT(*) AS c, COALESCE(SUM(amount), 0) AS total FROM fee_ledger GROUP BY status'
    );
    const fees = { pending_count: 0, pending_amount: 0, paid_count: 0, paid_amount: 0 };
    fs.forEach(f => {
      if (f.status === 'Pending') { fees.pending_count = Number(f.c); fees.pending_amount = Number(f.total); }
      if (f.status === 'Paid') { fees.paid_count = Number(f.c); fees.paid_amount = Number(f.total); }
    });
    const [outstanding] = await db.query(
      `SELECT s.student_id, u.name, SUM(f.amount) AS balance, DATE_FORMAT(MIN(f.due_date), '%Y-%m-%d') AS next_due
       FROM fee_ledger f
       JOIN students s ON s.student_id = f.student_id
       JOIN users u ON u.user_id = s.user_id
       WHERE f.status = 'Pending'
       GROUP BY s.student_id, u.name ORDER BY balance DESC`
    );

    const [[sc]] = await db.query('SELECT COUNT(*) AS c FROM students');
    const [[ac]] = await db.query('SELECT COUNT(*) AS c FROM allocations');

    res.json({
      generated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
      students: Number(sc.c),
      allocated: Number(ac.c),
      occupancy,
      occupancy_total: { capacity: totalCap, occupied: totalOcc, vacant: totalCap - totalOcc,
        percent: totalCap ? Math.round((totalOcc * 100) / totalCap) : 0 },
      complaints,
      avg_resolution_hours: avgHours,
      fees,
      outstanding: outstanding.map(o => ({ ...o, balance: Number(o.balance) })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
