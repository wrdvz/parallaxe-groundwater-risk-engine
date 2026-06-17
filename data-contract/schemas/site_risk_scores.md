# `site_risk_scores.parquet`

Precomputed screening output consumed by the app runtime.

The `/10` scores reflect the V2 "physical levels" method: each site is positioned on the observed
value scale for groundwater decline and withdrawal volume, then the two scores are averaged 50/50.

## MVP columns

- `site_id`
- `priority_level`
- `dependency_probability`
- `confidence_label`
- `risk_explanation_short`
- `score_version`
- `dependency_score_1_10`
- `groundwater_score_10`
- `withdrawal_score_10`
- `criticality_score_10`
- `is_water_relevant`
- `within_water_scope`
