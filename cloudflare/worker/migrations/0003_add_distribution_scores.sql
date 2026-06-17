ALTER TABLE site_hydro_context ADD COLUMN withdrawal_pressure_volume_m3 REAL;
ALTER TABLE site_hydro_context ADD COLUMN groundwater_decline_percentile REAL;
ALTER TABLE site_hydro_context ADD COLUMN withdrawal_volume_percentile REAL;
ALTER TABLE site_hydro_context ADD COLUMN groundwater_decline_decile INTEGER;
ALTER TABLE site_hydro_context ADD COLUMN withdrawal_volume_decile INTEGER;

ALTER TABLE site_risk_scores ADD COLUMN groundwater_score_10 REAL;
ALTER TABLE site_risk_scores ADD COLUMN withdrawal_score_10 REAL;
ALTER TABLE site_risk_scores ADD COLUMN criticality_score_10 REAL;
