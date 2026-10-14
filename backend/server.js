const express = require('express');
const cors = require('cors');
require('dotenv').config();
const db = require('./db');
const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');
const applicationRoutes = require('./routes/application');
const allocationRoutes = require('./routes/allocation');
const migrationRoutes = require('./routes/migration');
const { verifyToken, requireRole } = require('./middleware/auth');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.send('SHMS backend is running'));

app.use('/api/auth', authRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/allocations', allocationRoutes);
app.use('/api/migrations', migrationRoutes);
app.use('/api', studentRoutes);

app.get('/api/me', verifyToken, (req, res) => res.json(req.user));
app.get('/api/warden/test', verifyToken, requireRole('Warden'), (req, res) =>
  res.json({ message: 'Welcome Warden' })
);
app.get('/api/admin/test', verifyToken, requireRole('Admin'), (req, res) =>
  res.json({ message: 'Welcome Admin' })
);

app.get('/api/rooms', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM rooms');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT, () =>
  console.log('Server running on port ' + process.env.PORT)
);
