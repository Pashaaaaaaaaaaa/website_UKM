CREATE TABLE homepage_media_slots (
  slot_key text PRIMARY KEY CHECK (slot_key IN (
    'hero-1','hero-2','hero-3','hero-4','about',
    'structure-1','structure-2','structure-3','structure-4','structure-5',
    'service','footer'
  )),
  media_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
