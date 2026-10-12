CREATE UNIQUE INDEX booking_items_unique_inventory_item
  ON booking_items(booking_id,item_id) WHERE item_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_organization_unit_parent_type() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_type text;
BEGIN
  IF NEW.unit_type='DIVISI' THEN
    SELECT unit_type INTO parent_type FROM organization_units WHERE id=NEW.parent_id FOR UPDATE;
    IF parent_type IS DISTINCT FROM 'BIDANG' THEN
      RAISE EXCEPTION 'A division must have a bidang parent' USING ERRCODE='23514';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM organization_units WHERE parent_id=NEW.id) THEN
    RAISE EXCEPTION 'A bidang with divisions cannot change unit type' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER organization_unit_parent_type_guard
  BEFORE INSERT OR UPDATE OF unit_type,parent_id ON organization_units
  FOR EACH ROW EXECUTE FUNCTION enforce_organization_unit_parent_type();
