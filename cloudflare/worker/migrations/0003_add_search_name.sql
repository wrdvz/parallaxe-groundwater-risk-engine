ALTER TABLE companies ADD COLUMN search_name TEXT NOT NULL DEFAULT '';
ALTER TABLE sites ADD COLUMN search_name TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_companies_search_name ON companies(search_name);
CREATE INDEX IF NOT EXISTS idx_sites_search_name ON sites(search_name);
