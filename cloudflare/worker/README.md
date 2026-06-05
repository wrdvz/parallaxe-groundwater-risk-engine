# Worker

This directory will host the Cloudflare Worker API for the MVP.

Planned responsibilities:

- company search
- company to site resolution
- site detail retrieval
- portfolio screening aggregation

## Runtime strategy

The Worker is designed to:

1. run immediately with mock data
2. switch to D1 when the database binding is configured

This keeps the API contract stable while the data layer moves from prototype to
runtime storage.
