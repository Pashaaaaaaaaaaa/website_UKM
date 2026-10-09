ALTER TABLE articles ADD COLUMN IF NOT EXISTS thumbnail_media_id uuid REFERENCES media_assets(id) ON DELETE SET NULL;
ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_status_check;
ALTER TABLE articles ADD CONSTRAINT articles_status_check CHECK (status IN ('DRAFT','PUBLISHED','UNPUBLISHED','ARCHIVED'));
ALTER TABLE articles ADD COLUMN IF NOT EXISTS excerpt text;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS content text;
UPDATE articles SET content=body WHERE content IS NULL;
ALTER TABLE articles ALTER COLUMN content SET NOT NULL;

ALTER TABLE comments ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS status text;
UPDATE comments SET status=CASE WHEN is_approved THEN 'APPROVED' ELSE 'PENDING' END WHERE status IS NULL;
ALTER TABLE comments ALTER COLUMN status SET DEFAULT 'PENDING';
ALTER TABLE comments ALTER COLUMN status SET NOT NULL;
ALTER TABLE comments ADD CONSTRAINT comments_status_check CHECK(status IN ('PENDING','APPROVED','REJECTED'));
ALTER TABLE comments ADD CONSTRAINT comments_email_check CHECK(email IS NULL OR length(email)<=254);
CREATE INDEX IF NOT EXISTS comments_status_created_idx ON comments(status,created_at DESC);

ALTER TABLE organization_info ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE organization_info ADD COLUMN IF NOT EXISTS logo_media_id uuid REFERENCES media_assets(id) ON DELETE SET NULL;
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS division_id uuid REFERENCES divisions(id) ON DELETE SET NULL;
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE dance_services ADD COLUMN IF NOT EXISTS image_media_id uuid REFERENCES media_assets(id) ON DELETE SET NULL;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS image_media_id uuid REFERENCES media_assets(id) ON DELETE SET NULL;

ALTER TABLE payment_confirmations ADD COLUMN IF NOT EXISTS reviewed_status text;
UPDATE payment_confirmations SET reviewed_status=status WHERE reviewed_status IS NULL;
ALTER TABLE payment_confirmations ALTER COLUMN reviewed_status SET DEFAULT 'PENDING';

CREATE INDEX IF NOT EXISTS articles_category_idx ON articles(category_id,created_at DESC);
CREATE INDEX IF NOT EXISTS articles_slug_search_idx ON articles USING gin(to_tsvector('simple',title || ' ' || coalesce(excerpt,'')));
