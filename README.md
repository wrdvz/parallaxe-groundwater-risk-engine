# Parallaxe Groundwater Risk Engine

Search-first application to screen groundwater-related operational risk across company sites.

## What it does

Groundwater Risk Engine helps investors, insurers, and due diligence teams identify
sites potentially exposed to groundwater stress.

The application is designed to:

- search companies and establishments
- resolve companies into sites
- screen sites against precomputed groundwater exposure signals
- rank assets by priority
- explain why a site is flagged

This is not a generic ESG dashboard or a GIS exploration tool.

It is a search-first screening product for operational groundwater risk.

## Core product logic

The application relies on precomputed exposure layers combining:

- 20-year groundwater trend signals
- local withdrawal pressure
- ICPE sector enrichment
- SIRENE / SIRET site resolution
- geolocation confidence

The current risk logic is designed as a screening signal, not a full financial loss model.

## Typical workflow

1. Search a company by name
2. Select one or more establishments
3. Run screening
4. Review ranked sites and explanations
5. Identify critical assets for further diligence

## Target users

Target organizations:

- Private Equity funds
- insurers
- infrastructure investors
- lenders

Primary operational users:

- due diligence teams
- underwriting / risk teams
- investment teams

Secondary users:

- climate risk teams
- portfolio monitoring teams

## Relationship to other repositories

This repository is the product layer of a broader groundwater intelligence stack.

### Upstream repositories

- `parallaxe-groundwater-france-trends`
  - builds the underlying long-term groundwater trend signal

- `parallaxe-icpe-groundwater-exposure`
  - combines groundwater signals with ICPE and industrial exposure logic
  - exports product-ready parquet tables used by this application

This repository consumes those precomputed outputs and turns them into a search-first user experience.

## Expected upstream data contract

The MVP expects the following product tables from `parallaxe-icpe-groundwater-exposure`:

- `companies.parquet`
- `sites.parquet`
- `site_hydro_context.parquet`
- `site_risk_scores.parquet`

See `data-contract/` for details.

## MVP scope

The first version focuses on:

- search by company name
- input by SIREN / SIRET
- establishment resolution
- site selection
- ranked groundwater screening results
- map support
- short explanations
- geolocation confidence display

Out of scope for MVP:

- LEI / ISIN / parent-company mapping
- full regulatory modeling
- advanced PDF reporting
- complex GIS features

## Tech stack

### Compute upstream

- Python
- SQL
- DuckDB
- GeoPandas
- Shapely

### Runtime

- Cloudflare Workers
- Cloudflare D1
- Cloudflare R2
- Cloudflare Pages

## Product principles

- search-first
- asset-first
- explainable
- minimal
- fast to understand
- no GIS complexity

## Status

This repository is the application layer scaffold.

The current focus is:

1. define the data contract
2. implement company / site search
3. expose site-level groundwater screening
4. build the MVP portfolio workflow

## Author

Edward Vizard  
Parallaxe processing
