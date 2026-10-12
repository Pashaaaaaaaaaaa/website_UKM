-- The development articles predate category assignment. Assign the known activity article,
-- then place any remaining uncategorized published or draft articles in the general category.
UPDATE articles a
SET category_id=c.id
FROM article_categories c
WHERE a.category_id IS NULL
  AND a.slug='kegiatan-seni-budaya'
  AND c.slug='kegiatan';

UPDATE articles a
SET category_id=c.id
FROM article_categories c
WHERE a.category_id IS NULL
  AND c.slug='berita';
