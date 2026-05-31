# GitHub Creator Ranking

A static Astro site for ranking GitHub creators by programming-language-specific repository stars.

Phase 1 focuses on TypeScript and keeps the architecture extensible for more languages and countries.

## Commands

```sh
npm install
npm run data:generate
npm run build
npm run dev
```

## Workflows

- `Deploy static site` builds and deploys the committed `public/data` files to GitHub Pages. It runs on pushes to `main` and manual dispatch.
- `Refresh ranking data` runs twice daily at Beijing 06:00 and 18:00. It runs the GitHub crawler, writes updated JSON into `public/data`, commits those data files back to `main`, and dispatches the deploy workflow when data changes.

## Data model

Generated static JSON lives in `public/data/`:

- `meta.json` lists available languages and countries.
- `languages/<language>.json` contains global rankings.
- `countries/<country>/<language>.json` contains country rankings.
- `users/<login>.json` contains creator profile pages.

## Data generation

The crawler uses the GitHub public API. Set `GITHUB_TOKEN` for higher rate limits.

Useful environment variables:

```sh
GITHUB_TOKEN=...
LANGUAGES=TypeScript
TARGET_USERS=formulahendry
MIN_STARS=100
MAX_STARS=250000
DISCOVER_RANKINGS=true
SEARCH_PAGES=10
SEARCH_BUCKET_LIMIT=50
OWNER_PROFILE_LIMIT=1000
GLOBAL_LIMIT=500
COUNTRY_LIMIT=200
```

The crawler splits GitHub Search by star buckets when a query exceeds GitHub's 1,000-result search cap. API responses are cached in `.cache/github-api/`, and refresh checkpoints are stored in `.cache/state/`, so interrupted runs can resume without re-fetching completed requests or reprocessing completed buckets.

Set `DISABLE_GITHUB_CACHE=true` to bypass the API cache, or `RESET_REFRESH_STATE=true` to restart bucket processing from scratch. The refresh workflow restores `.cache/` with GitHub Actions cache and retries rate-limited API requests with backoff.

The country ranking uses public GitHub profile `location` text and is therefore approximate.
