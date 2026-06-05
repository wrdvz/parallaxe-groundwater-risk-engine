# Scripts

This directory will contain helper scripts for:

- loading upstream parquet tables
- syncing product data from `parallaxe-icpe-groundwater-exposure`
- preparing runtime tables for D1 / R2

Current script:

- `load_product_tables.py`
  - reads upstream parquet tables
  - creates a local SQLite runtime database
  - emits a SQL dump importable into Cloudflare D1
