-- Comments are published immediately, with sanitization and rate limiting enforced by the API.
UPDATE comments SET status='APPROVED',is_approved=true WHERE status='PENDING';
ALTER TABLE comments ALTER COLUMN status SET DEFAULT 'APPROVED';
ALTER TABLE comments ALTER COLUMN is_approved SET DEFAULT true;
