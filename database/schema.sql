-- Smart Hostel Management System (SHMS) - MySQL schema
CREATE DATABASE IF NOT EXISTS shms;
USE shms;

CREATE TABLE users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('Student','Warden','Admin') NOT NULL
);

-- BR-1: unique, verified Student ID
CREATE TABLE students (
  student_id VARCHAR(20) PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  phone VARCHAR(15),
  emergency_phone VARCHAR(15),
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- BR-3: exactly three room tiers
CREATE TABLE rooms (
  room_id INT AUTO_INCREMENT PRIMARY KEY,
  room_no VARCHAR(10) NOT NULL UNIQUE,
  tier ENUM('Single Sitter','Double Sharing','Triple Sharing') NOT NULL,
  capacity INT NOT NULL,
  occupied INT NOT NULL DEFAULT 0,
  CHECK (occupied >= 0 AND occupied <= capacity)
);

-- BR-2: one application per student per academic year
CREATE TABLE applications (
  app_id INT AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(20) NOT NULL,
  academic_year VARCHAR(9) NOT NULL,
  preference ENUM('Single Sitter','Double Sharing','Triple Sharing') NOT NULL,
  status ENUM('Pending','Allocated','Rejected') NOT NULL DEFAULT 'Pending',
  UNIQUE (student_id, academic_year),
  FOREIGN KEY (student_id) REFERENCES students(student_id)
);

-- BR-5: a student can hold only one room (UNIQUE student_id)
CREATE TABLE allocations (
  alloc_id INT AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(20) NOT NULL UNIQUE,
  room_id INT NOT NULL,
  warden_id INT NOT NULL,
  allocated_date DATE NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(student_id),
  FOREIGN KEY (room_id) REFERENCES rooms(room_id),
  FOREIGN KEY (warden_id) REFERENCES users(user_id)
);

-- BR-12: ticket status limited to three values
CREATE TABLE complaints (
  complaint_id INT AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(20) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'Other',
  title VARCHAR(150) NOT NULL,
  description TEXT,
  status ENUM('Open','In Progress','Resolved') NOT NULL DEFAULT 'Open',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  FOREIGN KEY (student_id) REFERENCES students(student_id)
);

-- BR-10: out-pass needs Warden authorization
CREATE TABLE outpasses (
  pass_id INT AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(20) NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  destination VARCHAR(150) NOT NULL DEFAULT '',
  reason VARCHAR(255),
  status ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  warden_id INT NULL,
  decided_at DATETIME NULL,
  FOREIGN KEY (student_id) REFERENCES students(student_id),
  FOREIGN KEY (warden_id) REFERENCES users(user_id)
);

-- BR-11: visiting window 4 PM - 7 PM (enforced in backend)
CREATE TABLE visitors (
  visitor_id INT AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(20) NOT NULL,
  visitor_name VARCHAR(100) NOT NULL,
  purpose VARCHAR(255),
  in_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  warden_signature VARCHAR(100) NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(student_id)
);

-- BR-8 / BR-9: roll call 9:00-9:30 PM (enforced in backend)
CREATE TABLE attendance (
  att_id INT AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(20) NOT NULL,
  att_date DATE NOT NULL,
  status ENUM('Present','Absent') NOT NULL,
  warden_id INT NOT NULL,
  UNIQUE (student_id, att_date),
  FOREIGN KEY (student_id) REFERENCES students(student_id),
  FOREIGN KEY (warden_id) REFERENCES users(user_id)
);

-- BR-7: only Admin edits fee status (enforced in backend)
CREATE TABLE fee_ledger (
  fee_id INT AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(20) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  due_date DATE NOT NULL,
  status ENUM('Pending','Paid') NOT NULL DEFAULT 'Pending',
  FOREIGN KEY (student_id) REFERENCES students(student_id)
);

-- FR-12: room migration requests (BR-6: only after an allocation exists, enforced in backend)
CREATE TABLE migration_requests (
  req_id INT AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(20) NOT NULL,
  current_room_id INT NOT NULL,
  preferred_tier ENUM('Single Sitter','Double Sharing','Triple Sharing') NOT NULL,
  reason VARCHAR(255),
  status ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  warden_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(student_id),
  FOREIGN KEY (current_room_id) REFERENCES rooms(room_id),
  FOREIGN KEY (warden_id) REFERENCES users(user_id)
);

-- Sample rooms so you can test later
INSERT INTO rooms (room_no, tier, capacity) VALUES
('101','Single Sitter',1),('102','Single Sitter',1),
('201','Double Sharing',2),('202','Double Sharing',2),
('301','Triple Sharing',3),('302','Triple Sharing',3);
