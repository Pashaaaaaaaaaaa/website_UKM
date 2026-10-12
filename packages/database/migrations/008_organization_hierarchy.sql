CREATE TABLE organization_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  unit_type text NOT NULL CHECK (unit_type IN ('BIDANG','DIVISI')),
  parent_id uuid REFERENCES organization_units(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_unit_parent_type_check CHECK ((unit_type='BIDANG' AND parent_id IS NULL) OR (unit_type='DIVISI' AND parent_id IS NOT NULL)),
  CONSTRAINT organization_unit_name_parent_unique UNIQUE(parent_id,name)
);
CREATE INDEX organization_units_tree_idx ON organization_units(unit_type,parent_id,sort_order);
CREATE UNIQUE INDEX organization_top_level_unit_name_idx ON organization_units(lower(name)) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX organization_child_unit_name_idx ON organization_units(parent_id,lower(name)) WHERE parent_id IS NOT NULL;
ALTER TABLE organization_members ADD COLUMN organization_unit_id uuid REFERENCES organization_units(id) ON DELETE SET NULL;
ALTER TABLE organization_members ADD COLUMN is_chairman boolean NOT NULL DEFAULT false;
ALTER TABLE organization_members ADD CONSTRAINT organization_chairman_unit_check CHECK (NOT is_chairman OR organization_unit_id IS NULL);
CREATE UNIQUE INDEX organization_one_active_chairman_idx ON organization_members(is_chairman) WHERE is_chairman AND is_active;
CREATE UNIQUE INDEX organization_one_active_unit_head_idx ON organization_members(organization_unit_id) WHERE organization_unit_id IS NOT NULL AND is_active;
