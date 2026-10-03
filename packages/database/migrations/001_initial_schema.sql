CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code IN ('NEWS_ADMIN','MANAGER','BRT_ADMIN')),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  is_development_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE divisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, slug text NOT NULL UNIQUE,
  description text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE article_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, slug text NOT NULL UNIQUE,
  excerpt text, body text NOT NULL, category_id uuid REFERENCES article_categories(id) ON DELETE SET NULL,
  author_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX articles_status_published_idx ON articles(status,published_at DESC);
CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE article_tags (
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(article_id,tag_id)
);
CREATE TABLE article_divisions (
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  division_id uuid NOT NULL REFERENCES divisions(id) ON DELETE CASCADE, PRIMARY KEY(article_id,division_id)
);
CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  customer_name text NOT NULL, body text NOT NULL, is_approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_article_moderation_idx ON comments(article_id,is_approved,created_at);

CREATE TABLE organization_info (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), singleton_key boolean NOT NULL DEFAULT true UNIQUE CHECK(singleton_key),
  name text NOT NULL, history text NOT NULL DEFAULT '', address text, phone text, email text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, position text NOT NULL,
  bio text, photo_media_id uuid, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dance_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '', price_per_performance numeric(12,2) NOT NULL CHECK(price_per_performance >= 0),
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE inventory_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), category_id uuid NOT NULL REFERENCES inventory_categories(id) ON DELETE RESTRICT,
  name text NOT NULL, slug text NOT NULL UNIQUE, description text NOT NULL DEFAULT '',
  price_per_unit_per_day numeric(12,2) NOT NULL CHECK(price_per_unit_per_day >= 0),
  total_quantity integer NOT NULL CHECK(total_quantity >= 0), is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_items_category_active_idx ON inventory_items(category_id,is_active);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_code text NOT NULL UNIQUE,
  customer_name text NOT NULL, customer_phone text NOT NULL, customer_email text,
  rental_domain text NOT NULL CHECK(rental_domain IN ('DANCE','BRT')),
  start_date date NOT NULL, end_date date NOT NULL CHECK(end_date >= start_date),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','CONFIRMED','ACTIVE','COMPLETED','CANCELLED','EXPIRED')),
  payment_status text NOT NULL DEFAULT 'UNPAID' CHECK(payment_status IN ('UNPAID','PENDING_CONFIRMATION','PAID','REJECTED','REFUNDED')),
  total_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(total_amount >= 0), expires_at timestamptz,
  payment_confirmed_at timestamptz,
  confirmed_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bookings_domain_dates_idx ON bookings(rental_domain,start_date,end_date);
CREATE INDEX bookings_status_created_idx ON bookings(status,created_at DESC);
CREATE TABLE booking_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  service_id uuid REFERENCES dance_services(id) ON DELETE RESTRICT,
  item_id uuid REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK(quantity > 0), unit_price_snapshot numeric(12,2) NOT NULL CHECK(unit_price_snapshot >= 0),
  rental_days integer NOT NULL CHECK(rental_days > 0), subtotal numeric(14,2) NOT NULL CHECK(subtotal >= 0),
  CHECK ((service_id IS NOT NULL)::integer + (item_id IS NOT NULL)::integer = 1)
);
CREATE INDEX booking_items_booking_idx ON booking_items(booking_id);
CREATE INDEX booking_items_service_idx ON booking_items(service_id) WHERE service_id IS NOT NULL;
CREATE INDEX booking_items_inventory_idx ON booking_items(item_id) WHERE item_id IS NOT NULL;
CREATE UNIQUE INDEX booking_items_unique_dance_service ON booking_items(booking_id,service_id) WHERE service_id IS NOT NULL;

CREATE FUNCTION enforce_booking_item_domain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE domain_value text;
BEGIN
  SELECT rental_domain INTO domain_value FROM bookings WHERE id=NEW.booking_id;
  IF (domain_value='DANCE' AND (NEW.service_id IS NULL OR NEW.item_id IS NOT NULL)) OR
     (domain_value='BRT' AND (NEW.item_id IS NULL OR NEW.service_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Booking items must belong to the booking rental domain' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER booking_item_domain_guard BEFORE INSERT OR UPDATE ON booking_items
FOR EACH ROW EXECUTE FUNCTION enforce_booking_item_domain();
CREATE FUNCTION enforce_booking_item_availability() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  booking_row bookings%ROWTYPE;
  capacity integer;
  already_reserved bigint;
BEGIN
  SELECT * INTO booking_row FROM bookings WHERE id=NEW.booking_id;
  IF NEW.service_id IS NOT NULL THEN
    PERFORM 1 FROM dance_services WHERE id=NEW.service_id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM booking_items i JOIN bookings b ON b.id=i.booking_id
      WHERE i.service_id=NEW.service_id AND b.id<>NEW.booking_id
        AND b.status IN ('PENDING','CONFIRMED','ACTIVE')
        AND (b.status<>'PENDING' OR b.expires_at>now())
        AND daterange(b.start_date,b.end_date,'[]') && daterange(booking_row.start_date,booking_row.end_date,'[]')
    ) THEN RAISE EXCEPTION 'Dance service is unavailable on those dates' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT total_quantity INTO capacity FROM inventory_items WHERE id=NEW.item_id FOR UPDATE;
    SELECT COALESCE(sum(i.quantity),0) INTO already_reserved
      FROM booking_items i JOIN bookings b ON b.id=i.booking_id
      WHERE i.item_id=NEW.item_id AND i.id IS DISTINCT FROM NEW.id
        AND b.status IN ('PENDING','CONFIRMED','ACTIVE')
        AND (b.status<>'PENDING' OR b.expires_at>now())
        AND daterange(b.start_date,b.end_date,'[]') && daterange(booking_row.start_date,booking_row.end_date,'[]');
    IF already_reserved + NEW.quantity > capacity THEN
      RAISE EXCEPTION 'Insufficient inventory for those dates' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER booking_item_availability_guard BEFORE INSERT OR UPDATE ON booking_items
FOR EACH ROW EXECUTE FUNCTION enforce_booking_item_availability();
CREATE FUNCTION prevent_mixed_booking_domain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM booking_items i WHERE i.booking_id=NEW.id AND
    ((NEW.rental_domain='DANCE' AND i.item_id IS NOT NULL) OR (NEW.rental_domain='BRT' AND i.service_id IS NOT NULL))) THEN
    RAISE EXCEPTION 'Booking domain cannot change while it has items' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER booking_domain_guard BEFORE UPDATE OF rental_domain ON bookings
FOR EACH ROW EXECUTE FUNCTION prevent_mixed_booking_domain();

CREATE TABLE booking_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  old_status text CHECK(old_status IS NULL OR old_status IN ('PENDING','CONFIRMED','ACTIVE','COMPLETED','CANCELLED','EXPIRED')),
  new_status text NOT NULL CHECK(new_status IN ('PENDING','CONFIRMED','ACTIVE','COMPLETED','CANCELLED','EXPIRED')),
  changed_by uuid REFERENCES admin_users(id) ON DELETE SET NULL, note text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  payment_method text NOT NULL, amount numeric(14,2) NOT NULL CHECK(amount >= 0), reference text,
  proof_media_id uuid, submitted_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz,
  reviewed_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED'))
);

CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket text NOT NULL CHECK(bucket IN ('news','services','items','organization')),
  object_path text NOT NULL, mime_type text NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes >= 0),
  alt_text text, uploaded_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(bucket,object_path)
);
ALTER TABLE organization_members ADD CONSTRAINT organization_member_photo_fk FOREIGN KEY(photo_media_id) REFERENCES media_assets(id) ON DELETE SET NULL;
ALTER TABLE payment_confirmations ADD CONSTRAINT payment_proof_media_fk FOREIGN KEY(proof_media_id) REFERENCES media_assets(id) ON DELETE SET NULL;

CREATE TABLE system_settings (
  key text PRIMARY KEY, value jsonb NOT NULL, description text,
  updated_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  action text NOT NULL, entity_type text NOT NULL, entity_id uuid, before_data jsonb, after_data jsonb,
  ip_address inet, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type,entity_id,created_at DESC);

CREATE FUNCTION record_booking_status_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO booking_status_history(booking_id,old_status,new_status) VALUES(NEW.id,NULL,NEW.status);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO booking_status_history(booking_id,old_status,new_status) VALUES(NEW.id,OLD.status,NEW.status);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER booking_status_audit_insert AFTER INSERT ON bookings
FOR EACH ROW EXECUTE FUNCTION record_booking_status_change();
CREATE TRIGGER booking_status_audit_update AFTER UPDATE OF status ON bookings
FOR EACH ROW EXECUTE FUNCTION record_booking_status_change();

-- Supabase Storage bucket provisioning is repeated in supabase/seed.sql.
