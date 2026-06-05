# Cloudflare runtime notes

This repository is expected to use:

- **Cloudflare Workers** for the API layer
- **Cloudflare D1** for serving compact relational product tables
- **Cloudflare R2** for raw datasets, larger artifacts, and future exports
- **Cloudflare Pages** for the frontend deployment

The API layer will eventually expose endpoints such as:

- `/search`
- `/company/:siren`
- `/site/:id`
- `/portfolio/analyze`
