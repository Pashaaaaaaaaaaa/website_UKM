-- Development-only public Storage buckets. Upload policies should be restricted per use case.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES
  ('news','news',true,26214400,ARRAY['image/jpeg','image/png','image/webp']),
  ('services','services',true,26214400,ARRAY['image/jpeg','image/png','image/webp']),
  ('items','items',true,26214400,ARRAY['image/jpeg','image/png','image/webp']),
  ('organization','organization',true,26214400,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO NOTHING;
