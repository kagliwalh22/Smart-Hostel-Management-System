-- Day 9: add a category column to complaints (FR-6 asks for issue category)
USE shms;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'Other' AFTER student_id;
