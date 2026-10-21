// SHMS automatic API test run.  Usage (inside backend folder, server must be running):
//   node tests/api-test.js
// Creates temporary students (IDs starting with TST), tests every FR and key BR, then deletes the test data.
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../db');

const BASE = 'http://localhost:' + (process.env.PORT || 5000);
const results = [];
let maxMs = 0;

async function call(method, url, token, body) {
  const t0 = Date.now();
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  const ms = Date.now() - t0;
  if (ms > maxMs) maxMs = ms;
  return { status: res.status, data, ms };
}

function t(ref, name, input, expected, r, ok) {
  const id = 'TC-' + String(results.length + 1).padStart(2, '0');
  let actual = r.actual;
  if (!actual) {
    const msg = r.data && !Array.isArray(r.data) && (r.data.error || r.data.message);
    actual = 'HTTP ' + r.status + (msg ? ' - ' + msg : '');
  }
  results.push({ id, ref, name, input, expected, actual, status: ok ? 'PASS' : 'FAIL', ms: r.ms });
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' [' + ref + '] ' + name + ' (' + r.ms + ' ms)');
}

const dateIn = n => {
  const x = new Date();
  x.setDate(x.getDate() + n);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
};
const login = (email, password) => call('POST', '/api/auth/login', null, { email, password });

async function run() {
  const stamp = String(Date.now()).slice(-6);
  const sidA = 'TST' + stamp, sidB = 'TST' + stamp + 'B';
  const emailA = 'tst' + stamp + 'a@test.local', emailB = 'tst' + stamp + 'b@test.local';
  const pw = 'test1234';
  let r;

  // ---------- FR-1 Login, NFR role-based access ----------
  r = await login('student@shms.com', 'student123');
  t('FR-1', 'Student login', 'student@shms.com / student123', 'HTTP 200, token, role Student', r,
    r.status === 200 && !!r.data?.token && r.data?.user?.role === 'Student');
  r = await login('warden@shms.com', 'warden123');
  const W = r.data?.token;
  t('FR-1', 'Warden login', 'warden@shms.com / warden123', 'HTTP 200, token, role Warden', r,
    r.status === 200 && !!W && r.data?.user?.role === 'Warden');
  r = await login('admin@shms.com', 'admin123');
  const A = r.data?.token;
  t('FR-1', 'Admin login', 'admin@shms.com / admin123', 'HTTP 200, token, role Admin', r,
    r.status === 200 && !!A && r.data?.user?.role === 'Admin');
  if (!W || !A) throw new Error('Seed users missing. Run: node seed.js');
  r = await login('student@shms.com', 'wrongpass');
  t('FR-1', 'Login with wrong password', 'student@shms.com / wrongpass', 'HTTP 401 Invalid email or password', r, r.status === 401);
  r = await login('', '');
  t('FR-1', 'Login with empty fields', 'empty email and password', 'HTTP 400 required', r, r.status === 400);
  r = await call('GET', '/api/me', null);
  t('NFR-2', 'Protected route without token', 'GET /api/me, no token', 'HTTP 401 Login required', r, r.status === 401);
  r = await call('GET', '/api/me', 'invalidtoken');
  t('NFR-2', 'Protected route with fake token', 'GET /api/me, fake token', 'HTTP 401 Invalid token', r, r.status === 401);

  // ---------- FR-2 Registration (BR-1) ----------
  const reg = (sid, email, extra = {}) => call('POST', '/api/register', null,
    { student_id: sid, name: 'Test ' + sid, email, password: pw, phone: '9876543210', emergency_phone: '9123456780', ...extra });
  r = await reg(sidA, emailA);
  t('FR-2', 'Register new student A', sidA + ', valid details', 'HTTP 201 Registered', r, r.status === 201);
  r = await reg(sidA, 'other' + emailA);
  t('BR-1', 'Duplicate Student ID rejected', sidA + ' again', 'HTTP 409 already registered', r, r.status === 409);
  r = await reg('AB', 'x' + emailA);
  t('FR-2', 'Invalid Student ID format', 'ID = AB', 'HTTP 400 ID must be 4-12 letters or digits', r, r.status === 400);
  r = await reg('TST' + stamp + 'C', emailA);
  t('FR-2', 'Duplicate email rejected', 'email of student A again', 'HTTP 409', r, r.status === 409);
  r = await reg(sidB, emailB);
  t('FR-2', 'Register new student B', sidB, 'HTTP 201 Registered', r, r.status === 201);
  const [hr] = await db.query('SELECT password_hash FROM users WHERE email = ?', [emailA]);
  const hash = hr[0] ? hr[0].password_hash : '';
  t('NFR-3', 'Password stored hashed', 'users.password_hash of student A', 'bcrypt hash starting with $2, not plain text',
    { actual: 'Stored value starts with ' + hash.slice(0, 7) + '... (' + hash.length + ' chars)', ms: 0 },
    hash.startsWith('$2') && hash !== pw);
  r = await login(emailA, pw);
  const SA = r.data?.token;
  t('FR-1', 'New student A can login', emailA, 'HTTP 200 + token', r, r.status === 200 && !!SA);
  r = await login(emailB, pw);
  const SB = r.data?.token;
  t('FR-1', 'New student B can login', emailB, 'HTTP 200 + token', r, r.status === 200 && !!SB);

  // ---------- FR-7 Profile ----------
  r = await call('GET', '/api/profile', SA);
  t('FR-7', 'View profile', 'GET /api/profile', 'HTTP 200 with own Student ID', r, r.status === 200 && r.data?.student_id === sidA);
  r = await call('PUT', '/api/profile', SA, { name: 'Updated Name', phone: '9000000001', emergency_phone: '9000000002' });
  t('FR-7', 'Edit profile', 'new name and phone numbers', 'HTTP 200 Profile updated', r, r.status === 200);
  r = await call('PUT', '/api/profile', SA, { name: 'Updated Name', phone: '123', emergency_phone: '9000000002' });
  t('FR-7', 'Invalid phone rejected', 'phone = 123', 'HTTP 400 must be 10 digits', r, r.status === 400);
  r = await call('GET', '/api/profile', SA);
  t('FR-7', 'Profile change persisted', 'GET /api/profile', 'name = Updated Name', r, r.data?.name === 'Updated Name');

  // ---------- FR-3 Hostel application (BR-2) ----------
  const apply = (tok, year, pref) => call('POST', '/api/applications', tok, { academic_year: year, preference: pref });
  r = await apply(SA, '2026-2027', 'Triple Sharing');
  t('FR-3', 'Submit hostel application', '2026-2027, Triple Sharing', 'HTTP 201 submitted', r, r.status === 201);
  r = await apply(SA, '2026-2027', 'Triple Sharing');
  t('BR-2', 'Second application same year rejected', '2026-2027 again', 'HTTP 409 already applied', r, r.status === 409);
  r = await apply(SA, '2026-2030', 'Triple Sharing');
  t('FR-3', 'Invalid academic year', '2026-2030', 'HTTP 400 format error', r, r.status === 400);
  r = await apply(W, '2026-2027', 'Triple Sharing');
  t('FR-3', 'Warden cannot apply for a hostel', 'Warden token', 'HTTP 403', r, r.status === 403);
  r = await apply(SB, '2026-2027', 'Single Sitter');
  t('FR-3', 'Student B applies', '2026-2027, Single Sitter', 'HTTP 201 submitted', r, r.status === 201);
  r = await call('GET', '/api/applications/mine', SA);
  t('FR-3', 'Student sees own applications', 'GET /api/applications/mine', 'HTTP 200, list with 1 item', r,
    r.status === 200 && Array.isArray(r.data) && r.data.length === 1);

  // ---------- FR-4 Room allocation (BR-3, BR-4, BR-5) ----------
  r = await call('GET', '/api/allocations/pending', W);
  const appA = (r.data || []).find(a => a.student_id === sidA);
  const appB = (r.data || []).find(a => a.student_id === sidB);
  t('FR-4', 'Warden sees pending applications', 'GET /api/allocations/pending', 'HTTP 200, both test applications listed', r,
    r.status === 200 && !!appA && !!appB);
  r = await call('GET', '/api/allocations/rooms', W);
  const rooms = Array.isArray(r.data) ? r.data : [];
  t('FR-4', 'Room capacity matrix', 'GET /api/allocations/rooms', 'HTTP 200, room list with vacancy', r, r.status === 200 && rooms.length > 0);
  const roomA = rooms.find(x => x.tier === 'Triple Sharing' && x.vacancy > 0);
  if (!roomA || !appA || !appB) throw new Error('Test needs a vacant Triple Sharing room');
  r = await call('POST', '/api/allocations', SA, { app_id: appA.app_id, room_id: roomA.room_id });
  t('BR-4', 'Student cannot allocate a room', 'Student token', 'HTTP 403 Access denied', r, r.status === 403);
  r = await call('POST', '/api/allocations', W, { app_id: appB.app_id, room_id: roomA.room_id });
  t('BR-3', 'Room tier must match preference', 'Single Sitter application to Triple room', 'HTTP 400 tier mismatch', r, r.status === 400);
  r = await call('POST', '/api/allocations', W, { app_id: appA.app_id, room_id: roomA.room_id });
  t('FR-4', 'Warden allocates a room', 'Triple application to room ' + roomA.room_no, 'HTTP 201 allocated', r, r.status === 201);
  r = await call('POST', '/api/allocations', W, { app_id: appA.app_id, room_id: roomA.room_id });
  t('FR-4', 'Same application cannot be allocated twice', 'same app_id again', 'HTTP 400 already processed', r, r.status === 400);
  r = await apply(SA, '2027-2028', 'Triple Sharing');
  t('BR-2', 'Application for a different year allowed', '2027-2028', 'HTTP 201 submitted', r, r.status === 201);
  r = await call('GET', '/api/allocations/pending', W);
  const app2 = (r.data || []).find(a => a.student_id === sidA);
  r = await call('POST', '/api/allocations', W, { app_id: app2 && app2.app_id, room_id: roomA.room_id });
  t('BR-5', 'One student cannot hold two rooms', 'allocate student A again', 'HTTP 409 already has a room', r, r.status === 409);
  r = await call('GET', '/api/allocations/mine', SA);
  t('FR-4', 'Student sees allocated room', 'GET /api/allocations/mine', 'HTTP 200, room ' + roomA.room_no, r, r.data?.room_no === roomA.room_no);

  // ---------- FR-12 Room migration (BR-6) ----------
  r = await call('POST', '/api/migrations', SB, { preferred_tier: 'Single Sitter', reason: 'test' });
  t('BR-6', 'Migration blocked before allocation', 'student B, no room', 'HTTP 400 only after allocation', r, r.status === 400);
  r = await call('POST', '/api/migrations', SA, { preferred_tier: 'Triple Sharing', reason: 'Need a change' });
  t('FR-12', 'Student requests migration', 'Triple Sharing, reason', 'HTTP 201 submitted', r, r.status === 201);
  r = await call('POST', '/api/migrations', SA, { preferred_tier: 'Triple Sharing', reason: 'Again' });
  t('FR-12', 'Second pending request rejected', 'request again', 'HTTP 409 already pending', r, r.status === 409);
  r = await call('GET', '/api/migrations/pending', W);
  const mig = (r.data || []).find(m => m.student_id === sidA);
  t('FR-12', 'Warden sees migration request', 'GET /api/migrations/pending', 'HTTP 200, request listed', r, r.status === 200 && !!mig);
  r = await call('GET', '/api/allocations/rooms', W);
  const target = (r.data || []).find(x => x.tier === 'Triple Sharing' && x.vacancy > 0 && x.room_id !== roomA.room_id);
  if (!mig || !target) throw new Error('Test needs a second vacant Triple Sharing room');
  r = await call('POST', '/api/migrations/' + mig.req_id + '/approve', SA, { room_id: target.room_id });
  t('FR-12', 'Student cannot approve migration', 'Student token', 'HTTP 403', r, r.status === 403);
  r = await call('POST', '/api/migrations/' + mig.req_id + '/approve', W, { room_id: target.room_id });
  t('FR-12', 'Warden approves migration', 'move to room ' + target.room_no, 'HTTP 200 moved', r, r.status === 200);
  r = await call('GET', '/api/allocations/mine', SA);
  t('FR-12', 'Student room changed after approval', 'GET /api/allocations/mine', 'room ' + target.room_no, r, r.data?.room_no === target.room_no);

  // ---------- FR-6 Complaint desk (BR-12) ----------
  r = await call('POST', '/api/complaints', SA, { category: 'Plumbing', title: 'Test tap', description: 'Leaking tap' });
  t('FR-6', 'Student raises complaint', 'Plumbing, Test tap', 'HTTP 201 status Open', r, r.status === 201);
  r = await call('GET', '/api/complaints/mine', SA);
  const cid = r.data && r.data[0] && r.data[0].complaint_id;
  t('FR-6', 'Complaint starts as Open', 'GET /api/complaints/mine', 'status = Open', r, r.data?.[0]?.status === 'Open');
  const setC = (tok, s) => call('PUT', '/api/complaints/' + cid + '/status', tok, { status: s });
  r = await setC(W, 'Resolved');
  t('BR-12', 'Cannot skip In Progress', 'Open -> Resolved', 'HTTP 400', r, r.status === 400);
  r = await setC(W, 'Closed');
  t('BR-12', 'Invalid status rejected', 'status = Closed', 'HTTP 400 must be Open, In Progress or Resolved', r, r.status === 400);
  r = await setC(SA, 'In Progress');
  t('FR-6', 'Student cannot change status', 'Student token', 'HTTP 403', r, r.status === 403);
  r = await setC(W, 'In Progress');
  t('FR-6', 'Warden: Open -> In Progress', 'status = In Progress', 'HTTP 200', r, r.status === 200);
  r = await setC(W, 'Resolved');
  t('FR-6', 'Warden: In Progress -> Resolved', 'status = Resolved', 'HTTP 200', r, r.status === 200);
  r = await setC(W, 'Open');
  t('BR-12', 'Resolved cannot go back', 'Resolved -> Open', 'HTTP 400', r, r.status === 400);

  // ---------- FR-11 Out-pass (BR-10) ----------
  const op = (tok, f, to) => call('POST', '/api/outpasses', tok, { from_date: f, to_date: to, destination: 'Home', reason: 'Family function' });
  r = await op(SA, dateIn(30), dateIn(32));
  t('FR-11', 'Student requests out-pass', dateIn(30) + ' to ' + dateIn(32), 'HTTP 201 sent', r, r.status === 201);
  r = await op(SA, dateIn(31), dateIn(33));
  t('FR-11', 'Overlapping out-pass rejected', 'overlapping dates', 'HTTP 409', r, r.status === 409);
  r = await op(SA, dateIn(-3), dateIn(-2));
  t('FR-11', 'Past date rejected', 'dates in the past', 'HTTP 400', r, r.status === 400);
  r = await op(SB, dateIn(30), dateIn(32));
  t('FR-11', 'Out-pass needs an allocated room', 'student B, no room', 'HTTP 400', r, r.status === 400);
  r = await call('GET', '/api/outpasses', W);
  const pass = (r.data || []).find(o => o.student_id === sidA);
  t('FR-11', 'Warden sees out-pass request', 'GET /api/outpasses', 'HTTP 200, request listed', r, r.status === 200 && !!pass);
  if (!pass) throw new Error('Out-pass not found');
  r = await call('POST', '/api/outpasses/' + pass.pass_id + '/decision', SA, { decision: 'Approved' });
  t('FR-11', 'Student cannot approve own out-pass', 'Student token', 'HTTP 403', r, r.status === 403);
  r = await call('POST', '/api/outpasses/' + pass.pass_id + '/decision', W, { decision: 'Approved' });
  t('FR-11', 'Warden approves out-pass', 'decision = Approved', 'HTTP 200 authorized by Warden ID', r, r.status === 200);
  r = await call('POST', '/api/outpasses/' + pass.pass_id + '/decision', W, { decision: 'Rejected' });
  t('BR-10', 'Decided out-pass is locked', 'change Approved -> Rejected', 'HTTP 400 locked', r, r.status === 400);
  r = await call('GET', '/api/outpasses/mine', SA);
  t('FR-11', 'Student sees Approved status', 'GET /api/outpasses/mine', 'status = Approved', r, r.data?.[0]?.status === 'Approved');

  // ---------- FR-9 Attendance (BR-8, BR-9) ----------
  r = await call('GET', '/api/attendance/roster', SA);
  t('FR-9', 'Student cannot open roll call', 'Student token', 'HTTP 403', r, r.status === 403);
  r = await call('GET', '/api/attendance/roster', W);
  const attOpen = !!(r.data && (r.data.window_open || r.data.override));
  t('FR-9', 'Warden opens roster', 'GET /api/attendance/roster', 'HTTP 200 with student list', r, r.status === 200 && Array.isArray(r.data?.students));
  r = await call('POST', '/api/attendance', W, { records: [] });
  t('BR-8', 'Roll call time window (9:00-9:30 PM)', 'submit now (' + (attOpen ? 'window/demo open' : 'window closed') + ')',
    attOpen ? 'HTTP 400 (open, but empty list)' : 'HTTP 403 outside 9:00-9:30 PM', r, r.status === (attOpen ? 400 : 403));
  r = await call('GET', '/api/attendance/mine', SA);
  t('FR-9', 'Student sees own attendance', 'GET /api/attendance/mine', 'HTTP 200 with summary', r, r.status === 200 && typeof r.data?.total === 'number');

  // ---------- FR-10 Visitor logs (BR-11) ----------
  r = await call('GET', '/api/visitors', SA);
  t('FR-10', 'Student cannot open visitor log', 'Student token', 'HTTP 403', r, r.status === 403);
  r = await call('GET', '/api/visitors', W);
  const visOpen = !!(r.data && (r.data.window_open || r.data.override));
  t('FR-10', 'Warden opens visitor log', 'GET /api/visitors', 'HTTP 200', r, r.status === 200);
  r = await call('POST', '/api/visitors', W, { student_id: sidA, visitor_name: 'Test Visitor', purpose: 'Visit', warden_signature: 'Test Warden' });
  t('BR-11', 'Visiting window (4:00-7:00 PM)', 'check in visitor now (' + (visOpen ? 'window/demo open' : 'window closed') + ')',
    visOpen ? 'HTTP 201 logged' : 'HTTP 403 outside 4:00-7:00 PM', r, r.status === (visOpen ? 201 : 403));

  // ---------- FR-5 Fee status (BR-7) ----------
  const feeBody = { student_id: sidA, amount: 5000, due_date: dateIn(30) };
  r = await call('POST', '/api/fees', W, feeBody);
  t('BR-7', 'Warden cannot edit fees', 'Warden token', 'HTTP 403', r, r.status === 403);
  r = await call('POST', '/api/fees', SA, feeBody);
  t('BR-7', 'Student cannot edit fees', 'Student token', 'HTTP 403', r, r.status === 403);
  r = await call('POST', '/api/fees', A, feeBody);
  t('FR-5', 'Admin adds fee record', 'amount 5000', 'HTTP 201 added', r, r.status === 201);
  r = await call('GET', '/api/fees', A);
  const fee = (r.data || []).find(x => x.student_id === sidA);
  t('FR-5', 'Admin sees fee ledger', 'GET /api/fees', 'HTTP 200, record listed', r, r.status === 200 && !!fee);
  if (!fee) throw new Error('Fee not found');
  r = await call('PUT', '/api/fees/' + fee.fee_id + '/status', A, { status: 'Late' });
  t('FR-5', 'Invalid fee status rejected', 'status = Late', 'HTTP 400', r, r.status === 400);
  r = await call('PUT', '/api/fees/' + fee.fee_id + '/status', W, { status: 'Paid' });
  t('BR-7', 'Warden cannot mark fee paid', 'Warden token', 'HTTP 403', r, r.status === 403);
  r = await call('PUT', '/api/fees/' + fee.fee_id + '/status', A, { status: 'Paid' });
  t('FR-5', 'Admin marks fee Paid', 'status = Paid', 'HTTP 200', r, r.status === 200);
  r = await call('GET', '/api/fees/mine', SA);
  t('FR-5', 'Student sees fee as Paid', 'GET /api/fees/mine', 'status = Paid', r, r.data?.[0]?.status === 'Paid');

  // ---------- FR-8 Reports (BR-13) ----------
  r = await call('GET', '/api/reports/summary', W);
  t('BR-13', 'Warden cannot generate reports', 'Warden token', 'HTTP 403', r, r.status === 403);
  r = await call('GET', '/api/reports/summary', SA);
  t('BR-13', 'Student cannot generate reports', 'Student token', 'HTTP 403', r, r.status === 403);
  r = await call('GET', '/api/reports/summary', A);
  t('FR-8', 'Admin generates report', 'GET /api/reports/summary', 'HTTP 200 with occupancy, complaints and fees', r,
    r.status === 200 && Array.isArray(r.data?.occupancy) && !!r.data?.fees && !!r.data?.complaints);

  // ---------- FR-13 Email notifier ----------
  r = await call('POST', '/api/notifier/run', W);
  t('FR-13', 'Warden cannot run reminder job', 'Warden token', 'HTTP 403', r, r.status === 403);
  r = await call('POST', '/api/notifier/run', SA);
  t('FR-13', 'Student cannot run reminder job', 'Student token', 'HTTP 403', r, r.status === 403);

  // ---------- NFR performance ----------
  t('NFR-1', 'Response time under 3 seconds', 'slowest of all ' + results.length + ' calls above', 'every request < 3000 ms',
    { actual: 'Slowest response: ' + maxMs + ' ms', ms: maxMs }, maxMs < 3000);
}

async function cleanup() {
  try {
    await db.query(`UPDATE rooms r JOIN (SELECT room_id, COUNT(*) c FROM allocations WHERE student_id LIKE 'TST%' GROUP BY room_id) a
                    ON a.room_id = r.room_id SET r.occupied = r.occupied - a.c`);
    for (const tbl of ['migration_requests', 'outpasses', 'complaints', 'visitors', 'attendance', 'fee_ledger', 'allocations', 'applications']) {
      await db.query('DELETE FROM ' + tbl + " WHERE student_id LIKE 'TST%'");
    }
    await db.query("DELETE FROM students WHERE student_id LIKE 'TST%'");
    await db.query("DELETE FROM users WHERE email LIKE 'tst%@test.local'");
    console.log('\nTest data cleaned up.');
  } catch (err) {
    console.log('\nCleanup problem:', err.message);
  }
}

function writeCsv() {
  const esc = v => '"' + String(v).replace(/"/g, '""') + '"';
  const head = ['Test ID', 'Requirement', 'Test case', 'Input', 'Expected result', 'Actual result', 'Status', 'Time (ms)'];
  const rows = results.map(x => [x.id, x.ref, x.name, x.input, x.expected, x.actual, x.status, x.ms]);
  const csv = '\ufeff' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
  const file = path.join(__dirname, 'test-results.csv');
  fs.writeFileSync(file, csv);
  return file;
}

(async () => {
  try {
    await run();
  } catch (err) {
    console.log('\nTEST RUN STOPPED: ' + err.message);
  } finally {
    await cleanup();
    const pass = results.filter(x => x.status === 'PASS').length;
    const fails = results.filter(x => x.status === 'FAIL');
    console.log('\n===== SUMMARY =====');
    console.log('Total: ' + results.length + '   Passed: ' + pass + '   Failed: ' + fails.length + '   Slowest: ' + maxMs + ' ms');
    fails.forEach(f => console.log('  FAILED ' + f.id + ' [' + f.ref + '] ' + f.name + ' -> ' + f.actual));
    console.log('Results file: ' + writeCsv());
    await db.end();
    process.exit(fails.length ? 1 : 0);
  }
})();
