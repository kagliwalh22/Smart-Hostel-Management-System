const bcrypt = require('bcryptjs');
const db = require('./db');

(async () => {
    const users = [
        ['Test Student', 'student@shms.com', 'student123', 'Student'],
        ['Test Warden', 'warden@shms.com', 'warden123', 'Warden'],
        ['Test Admin', 'admin@shms.com', 'admin123', 'Admin'],
    ];
    for (const [name, email, pw, role] of users) {
        const hash = await bcrypt.hash(pw, 10);
        await db.query(
            'INSERT IGNORE INTO users (name, email, password_hash, role) VALUES (?,?,?,?)',
            [name, email, hash, role]
        );
    }
    const [[s]] = await db.query("SELECT user_id FROM users WHERE email='student@shms.com'");
    await db.query(
        "INSERT IGNORE INTO students (student_id, user_id, phone, emergency_phone) VALUES ('S001', ?, '9999999999', '8888888888')",
        [s.user_id]
    );
    console.log('Seed done');
    process.exit();
})();