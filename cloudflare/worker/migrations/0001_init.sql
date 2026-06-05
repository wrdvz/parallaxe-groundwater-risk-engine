CREATE TABLE IF NOT EXISTS companies (
  siren TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  naf_code REAL,
  naf_label TEXT,
  normalized_name TEXT NOT NULL,
  search_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companies_france (
  siren TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  search_name TEXT NOT NULL,
  naf_code TEXT,
  legal_category TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sites (
  site_id TEXT PRIMARY KEY,
  siret TEXT NOT NULL,
  siren TEXT NOT NULL,
  site_name TEXT NOT NULL,
  company_name TEXT NOT NULL,
  address_line TEXT,
  postal_code TEXT,
  city TEXT,
  lat REAL,
  lon REAL,
  is_geolocated INTEGER NOT NULL,
  is_icpe INTEGER NOT NULL,
  icpe_category TEXT,
  naf_code REAL,
  naf_label TEXT,
  source_url TEXT,
  geo_score REAL,
  geo_type TEXT,
  geoloc_confidence_label TEXT,
  search_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_hydro_context (
  site_id TEXT PRIMARY KEY,
  station_count INTEGER,
  aquifer_trend_value_cm_20y REAL,
  aquifer_trend_mean_cm_20y REAL,
  nearest_station_distance_km REAL,
  groundwater_signal_robust INTEGER NOT NULL,
  aquifer_trend_level TEXT,
  aquifer_signal_marker TEXT,
  grid_class TEXT,
  pressure_level TEXT
);

CREATE TABLE IF NOT EXISTS site_risk_scores (
  site_id TEXT PRIMARY KEY,
  priority_level TEXT NOT NULL,
  dependency_probability TEXT NOT NULL,
  confidence_label TEXT NOT NULL,
  risk_explanation_short TEXT NOT NULL,
  score_version TEXT NOT NULL,
  dependency_score_1_10 REAL,
  is_water_relevant INTEGER NOT NULL DEFAULT 0,
  within_water_scope INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_companies_normalized_name ON companies(normalized_name);
CREATE INDEX IF NOT EXISTS idx_companies_search_name ON companies(search_name);
CREATE INDEX IF NOT EXISTS idx_companies_france_normalized_name ON companies_france(normalized_name);
CREATE INDEX IF NOT EXISTS idx_companies_france_search_name ON companies_france(search_name);
CREATE INDEX IF NOT EXISTS idx_sites_siren ON sites(siren);
CREATE INDEX IF NOT EXISTS idx_sites_siret ON sites(siret);
CREATE INDEX IF NOT EXISTS idx_sites_company_name ON sites(company_name);
CREATE INDEX IF NOT EXISTS idx_sites_search_name ON sites(search_name);
CREATE INDEX IF NOT EXISTS idx_sites_city ON sites(city);
CREATE INDEX IF NOT EXISTS idx_sites_is_icpe ON sites(is_icpe);
CREATE INDEX IF NOT EXISTS idx_site_risk_priority ON site_risk_scores(priority_level);
