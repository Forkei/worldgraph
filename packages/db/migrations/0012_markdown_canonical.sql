-- Markdown is the canonical text (model v0.3 §1.2). `text` now holds footnoted markdown (exactly what a
-- reading agent sees); `link_table` holds the numbered links referenced from it, for navigation.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS link_table jsonb NOT NULL DEFAULT '[]';
