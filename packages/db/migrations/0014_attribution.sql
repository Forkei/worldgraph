-- Attribution (model v0.4 §1.4): when a page says "according to X" / "per the county filing", the fact's
-- origin is X, not the page repeating it. Independence is counted by origin, so a dozen sites all citing
-- Reuters are ONE origin. Empty when the page is itself the origin.
ALTER TABLE relation_claims  ADD COLUMN IF NOT EXISTS attributed_to text;
ALTER TABLE attribute_claims ADD COLUMN IF NOT EXISTS attributed_to text;
