-- Day 8: table for room migration requests (FR-12)
USE shms;

CREATE TABLE IF NOT EXISTS migration_requests (
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
