# Data contract

This directory documents the MVP contract between:

- `parallaxe-icpe-groundwater-exposure` (compute repo)
- `parallaxe-groundwater-risk-engine` (product repo)

The current MVP expects four parquet tables generated upstream:

- `companies.parquet`
- `sites.parquet`
- `site_hydro_context.parquet`
- `site_risk_scores.parquet`

The goal is to keep the application repo independent from heavy compute logic.

The compute repository is responsible for:

- source ingestion
- cleaning
- hydrological processing
- ICPE enrichment
- risk scoring
- parquet export generation

This repository is responsible for:

- search
- company and site resolution
- portfolio workflow
- results rendering
- runtime APIs

Each schema is documented in `schemas/`.
