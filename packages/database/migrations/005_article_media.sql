CREATE TABLE article_media (
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(article_id,media_id)
);
CREATE INDEX article_media_order_idx ON article_media(article_id,sort_order);
