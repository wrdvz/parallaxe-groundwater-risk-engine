CREATE TABLE IF NOT EXISTS companies_france (
  siren TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  search_name TEXT NOT NULL,
  naf_code TEXT,
  legal_category TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_companies_france_normalized_name ON companies_france(normalized_name);
CREATE INDEX IF NOT EXISTS idx_companies_france_search_name ON companies_france(search_name);
