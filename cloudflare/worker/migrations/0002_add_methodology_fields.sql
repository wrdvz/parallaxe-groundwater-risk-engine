ALTER TABLE site_risk_scores ADD COLUMN dependency_score_1_10 REAL;
ALTER TABLE site_risk_scores ADD COLUMN is_water_relevant INTEGER NOT NULL DEFAULT 0;
ALTER TABLE site_risk_scores ADD COLUMN within_water_scope INTEGER NOT NULL DEFAULT 0;
