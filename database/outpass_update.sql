-- Day 10: extra columns for out-pass (destination + decision time)
USE shms;
ALTER TABLE outpasses ADD COLUMN IF NOT EXISTS destination VARCHAR(150) NOT NULL DEFAULT '' AFTER to_date;
ALTER TABLE outpasses ADD COLUMN IF NOT EXISTS decided_at DATETIME NULL;
