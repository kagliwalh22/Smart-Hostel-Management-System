const express = require('express');
const { verifyToken, requireRole } = require('../middleware/auth');
const { sendDueReminders } = require('../notifier');

const router = express.Router();

// Admin can trigger the reminder job by hand (useful for demo)
router.post('/run', verifyToken, requireRole('Admin'), async (req, res) => {
  try {
    res.json(await sendDueReminders());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
