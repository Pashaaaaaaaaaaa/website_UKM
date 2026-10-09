ALTER TABLE bookings ADD COLUMN notes text;
ALTER TABLE bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE bookings DROP CONSTRAINT bookings_payment_status_check;
ALTER TABLE booking_status_history DROP CONSTRAINT booking_status_history_old_status_check;
ALTER TABLE booking_status_history DROP CONSTRAINT booking_status_history_new_status_check;

UPDATE bookings SET
  status = CASE status
    WHEN 'PENDING' THEN 'PENDING_PAYMENT'
    WHEN 'ACTIVE' THEN 'CONFIRMED'
    WHEN 'COMPLETED' THEN 'CONFIRMED'
    WHEN 'CANCELLED' THEN 'EXPIRED'
    ELSE status
  END,
  payment_status = CASE
    WHEN status IN ('CONFIRMED','ACTIVE','COMPLETED') THEN 'PAID'
    ELSE 'UNPAID'
  END,
  payment_confirmed_at = CASE
    WHEN status IN ('CONFIRMED','ACTIVE','COMPLETED') THEN COALESCE(payment_confirmed_at, created_at)
    ELSE NULL
  END;

UPDATE booking_status_history SET
  old_status = CASE old_status
    WHEN 'PENDING' THEN 'PENDING_PAYMENT'
    WHEN 'ACTIVE' THEN 'CONFIRMED'
    WHEN 'COMPLETED' THEN 'CONFIRMED'
    WHEN 'CANCELLED' THEN 'EXPIRED'
    ELSE old_status
  END,
  new_status = CASE new_status
    WHEN 'PENDING' THEN 'PENDING_PAYMENT'
    WHEN 'ACTIVE' THEN 'CONFIRMED'
    WHEN 'COMPLETED' THEN 'CONFIRMED'
    WHEN 'CANCELLED' THEN 'EXPIRED'
    ELSE new_status
  END;

UPDATE bookings
SET expires_at = created_at + interval '24 hours'
WHERE status = 'PENDING_PAYMENT';

ALTER TABLE bookings ALTER COLUMN status SET DEFAULT 'PENDING_PAYMENT';

ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN ('PENDING_PAYMENT','CONFIRMED','EXPIRED'));
ALTER TABLE bookings ADD CONSTRAINT bookings_payment_status_check CHECK (payment_status IN ('UNPAID','PAID'));
ALTER TABLE bookings ADD CONSTRAINT bookings_state_payment_check CHECK (
  (status = 'PENDING_PAYMENT' AND payment_status = 'UNPAID' AND expires_at IS NOT NULL AND payment_confirmed_at IS NULL)
  OR (status = 'CONFIRMED' AND payment_status = 'PAID' AND payment_confirmed_at IS NOT NULL)
  OR (status = 'EXPIRED' AND payment_status = 'UNPAID')
);
ALTER TABLE bookings ADD CONSTRAINT bookings_notes_length_check CHECK (notes IS NULL OR length(notes) <= 2000);
ALTER TABLE booking_status_history ADD CONSTRAINT booking_status_history_old_status_check
  CHECK (old_status IS NULL OR old_status IN ('PENDING_PAYMENT','CONFIRMED','EXPIRED'));
ALTER TABLE booking_status_history ADD CONSTRAINT booking_status_history_new_status_check
  CHECK (new_status IN ('PENDING_PAYMENT','CONFIRMED','EXPIRED'));
ALTER TABLE booking_items ADD CONSTRAINT booking_items_dance_quantity_check CHECK (service_id IS NULL OR quantity = 1);

CREATE INDEX bookings_pending_expiry_idx ON bookings(expires_at,id) WHERE status = 'PENDING_PAYMENT';
CREATE INDEX bookings_active_rental_dates_idx ON bookings(rental_domain,start_date,end_date) WHERE status IN ('PENDING_PAYMENT','CONFIRMED');

CREATE TABLE booking_code_sequences (
  booking_date date PRIMARY KEY,
  last_value bigint NOT NULL CHECK (last_value > 0)
);

CREATE OR REPLACE FUNCTION enforce_booking_state_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'PENDING_PAYMENT' THEN
    RAISE EXCEPTION 'New bookings must start as PENDING_PAYMENT' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NOT (
    OLD.status = 'PENDING_PAYMENT' AND NEW.status IN ('CONFIRMED','EXPIRED')
  ) THEN
    RAISE EXCEPTION 'Invalid booking state transition: % -> %', OLD.status, NEW.status USING ERRCODE='23514';
  END IF;
  IF NEW.status = 'CONFIRMED' AND (NEW.payment_status <> 'PAID' OR NEW.payment_confirmed_at IS NULL) THEN
    RAISE EXCEPTION 'Confirmed bookings must have paid status and confirmation time' USING ERRCODE='23514';
  END IF;
  IF NEW.status IN ('PENDING_PAYMENT','EXPIRED') AND NEW.payment_status <> 'UNPAID' THEN
    RAISE EXCEPTION 'Pending or expired bookings must remain unpaid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER booking_state_transition_guard BEFORE INSERT OR UPDATE OF status,payment_status,payment_confirmed_at
ON bookings FOR EACH ROW EXECUTE FUNCTION enforce_booking_state_transition();

CREATE OR REPLACE FUNCTION enforce_booking_item_domain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE booking_row bookings%ROWTYPE;
BEGIN
  SELECT * INTO booking_row FROM bookings WHERE id=NEW.booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking does not exist' USING ERRCODE='23503'; END IF;
  IF (booking_row.rental_domain='DANCE' AND (NEW.service_id IS NULL OR NEW.item_id IS NOT NULL OR NEW.quantity <> 1)) OR
     (booking_row.rental_domain='BRT' AND (NEW.item_id IS NULL OR NEW.service_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Booking items must belong to the booking rental domain' USING ERRCODE='23514';
  END IF;
  IF NEW.rental_days <> (booking_row.end_date - booking_row.start_date + 1) OR
     NEW.subtotal <> NEW.unit_price_snapshot * NEW.quantity * NEW.rental_days THEN
    RAISE EXCEPTION 'Booking item price or rental duration is invalid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION enforce_booking_item_availability() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  booking_row bookings%ROWTYPE;
  capacity integer;
  unavailable_date date;
BEGIN
  SELECT * INTO booking_row FROM bookings WHERE id=NEW.booking_id;
  IF booking_row.status NOT IN ('PENDING_PAYMENT','CONFIRMED') OR
     (booking_row.status='PENDING_PAYMENT' AND booking_row.expires_at <= clock_timestamp()) THEN
    RAISE EXCEPTION 'Only active bookings may reserve resources' USING ERRCODE='23514';
  END IF;
  IF NEW.service_id IS NOT NULL THEN
    PERFORM 1 FROM dance_services WHERE id=NEW.service_id AND is_active FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dance service is unavailable' USING ERRCODE='23514'; END IF;
    IF EXISTS (
      SELECT 1 FROM booking_items i JOIN bookings b ON b.id=i.booking_id
      WHERE i.service_id=NEW.service_id AND b.id<>NEW.booking_id
        AND (b.status='CONFIRMED' OR (b.status='PENDING_PAYMENT' AND b.expires_at>clock_timestamp()))
        AND b.start_date <= booking_row.end_date AND b.end_date >= booking_row.start_date
    ) THEN RAISE EXCEPTION 'Dance service is unavailable on those dates' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT total_quantity INTO capacity FROM inventory_items WHERE id=NEW.item_id AND is_active FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Inventory item is unavailable' USING ERRCODE='23514'; END IF;
    SELECT d.day::date INTO unavailable_date
    FROM generate_series(booking_row.start_date::timestamp, booking_row.end_date::timestamp, interval '1 day') AS d(day)
    WHERE NEW.quantity + COALESCE((
      SELECT sum(i.quantity) FROM booking_items i JOIN bookings b ON b.id=i.booking_id
      WHERE i.item_id=NEW.item_id AND i.booking_id<>NEW.booking_id
        AND (b.status='CONFIRMED' OR (b.status='PENDING_PAYMENT' AND b.expires_at>clock_timestamp()))
        AND b.start_date <= d.day::date AND b.end_date >= d.day::date
    ),0) > capacity
    LIMIT 1;
    IF unavailable_date IS NOT NULL THEN
      RAISE EXCEPTION 'Insufficient inventory on %', unavailable_date USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION record_booking_status_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor_id uuid;
BEGIN
  actor_id := NULLIF(current_setting('app.actor_id', true), '')::uuid;
  IF TG_OP='INSERT' THEN
    INSERT INTO booking_status_history(booking_id,old_status,new_status,changed_by)
    VALUES(NEW.id,NULL,NEW.status,actor_id);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO booking_status_history(booking_id,old_status,new_status,changed_by)
    VALUES(NEW.id,OLD.status,NEW.status,actor_id);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION expire_pending_bookings(batch_size integer DEFAULT 500)
RETURNS TABLE(booking_code text) LANGUAGE sql AS $$
  WITH candidates AS (
    SELECT b.id FROM bookings b
    WHERE b.status='PENDING_PAYMENT' AND b.expires_at <= clock_timestamp()
    ORDER BY b.expires_at,b.id
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1,LEAST(batch_size,5000))
  )
  UPDATE bookings b SET status='EXPIRED',updated_at=clock_timestamp()
  FROM candidates c WHERE b.id=c.id
  RETURNING b.booking_code
$$;
