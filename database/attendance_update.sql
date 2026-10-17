-- Day 11: remark column (used as the exception log for absent students, BR-9)
USE shms;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS remark VARCHAR(150) NULL AFTER status;
