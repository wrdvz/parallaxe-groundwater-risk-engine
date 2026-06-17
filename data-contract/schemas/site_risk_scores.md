# `site_risk_scores.parquet`

Precomputed screening output consumed by the app runtime.

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
