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

The crawler splits GitHub Search by star buckets when a query exceeds GitHub's 1,000-result search cap. API responses are cached in `.cache/github-api/`, so interrupted runs can resume without re-fetching completed requests. Set `DISABLE_GITHUB_CACHE=true` to bypass the cache.

GitHub Actions disables discovery by default to keep Pages deployments reliable with the built-in `GITHUB_TOKEN` Search API limits. Set repository variables such as `DISCOVER_RANKINGS=true`, `SEARCH_BUCKET_LIMIT`, and `SEARCH_PAGES` when you want scheduled deployments to run broader discovery.

The country ranking uses public GitHub profile `location` text and is therefore approximate.
