import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCountry } from './normalize-location';
import type {
  CountryConfig,
  LanguageConfig,
  RankingDataset,
  RankingItem,
  SiteMeta,
  TopRepository,
  UserDataset,
  UserLanguageStats,
} from '../src/lib/types';

interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
  location: string | null;
  type: string;
}

interface GitHubRepo {
  name: string;
  full_name: string;
  html_url: string;
  fork: boolean;
  stargazers_count: number;
  language: string | null;
  languages_url: string;
  owner: {
    login: string;
    avatar_url: string;
    html_url: string;
    type: string;
  };
}

interface SearchResponse {
  total_count: number;
  items: GitHubRepo[];
}

interface LanguageStats {
  starsPrimary: number;
  repoCountPrimary: number;
  starsContains: number;
  repoCountContains: number;
  topRepos: Map<string, TopRepository>;
}

interface OwnerStats {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
  location: string | null;
  countryCode: string | null;
  profileHydrated?: boolean;
  languages: Map<string, LanguageStats>;
}

interface GenerateOptions {
  seedOnly?: boolean;
}

interface SearchBucketCoverage {
  language: string;
  stars: string;
  totalCount: number;
  collectedRepos: number;
  truncated: boolean;
}

interface CoverageReport {
  generatedAt: string;
  isPartial: boolean;
  minStars: number;
  maxStars: number;
  searchPagesPerBucket: number;
  searchBucketLimit: number;
  buckets: SearchBucketCoverage[];
}

interface SerializedLanguageStats {
  starsPrimary: number;
  repoCountPrimary: number;
  starsContains: number;
  repoCountContains: number;
  topRepos: TopRepository[];
}

interface SerializedOwnerStats {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
  location: string | null;
  countryCode: string | null;
  profileHydrated?: boolean;
  languages: Array<[string, SerializedLanguageStats]>;
}

interface RefreshState {
  version: 1;
  generatedAt: string;
  config: {
    languages: string[];
    minStars: number;
    maxStars: number;
  };
  owners: SerializedOwnerStats[];
  coverage: SearchBucketCoverage[];
}

const dataRoot = fileURLToPath(new URL('../public/data/', import.meta.url));
const cacheRoot = fileURLToPath(new URL('../.cache/github-api/', import.meta.url));
const stateRoot = fileURLToPath(new URL('../.cache/state/', import.meta.url));
const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

const countries: CountryConfig[] = [{ slug: 'china', name: 'China', code: 'CN' }];

const seedUser: OwnerStats = {
  login: 'formulahendry',
  name: 'Jun Han',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1050213?v=4',
  htmlUrl: 'https://github.com/formulahendry',
  location: 'Shanghai, China',
  countryCode: 'CN',
  languages: new Map([
    [
      'typescript',
      {
        starsPrimary: 5929,
        repoCountPrimary: 35,
        starsContains: 6291,
        repoCountContains: 38,
        topRepos: new Map([
          [
            'formulahendry/vscode-code-runner',
            {
              name: 'vscode-code-runner',
              fullName: 'formulahendry/vscode-code-runner',
              stars: 2406,
              url: 'https://github.com/formulahendry/vscode-code-runner',
              primaryLanguage: 'TypeScript',
            },
          ],
          [
            'formulahendry/wechat-acp',
            {
              name: 'wechat-acp',
              fullName: 'formulahendry/wechat-acp',
              stars: 654,
              url: 'https://github.com/formulahendry/wechat-acp',
              primaryLanguage: 'TypeScript',
            },
          ],
          [
            'formulahendry/mcp-server-spec-driven-development',
            {
              name: 'mcp-server-spec-driven-development',
              fullName: 'formulahendry/mcp-server-spec-driven-development',
              stars: 430,
              url: 'https://github.com/formulahendry/mcp-server-spec-driven-development',
              primaryLanguage: 'TypeScript',
            },
          ],
        ]),
      },
    ],
  ]),
};

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function getLanguages(): LanguageConfig[] {
  return (process.env.LANGUAGES ?? 'TypeScript')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ slug: slugify(name), name, githubQuery: name }));
}

function getTargetUsers(): string[] {
  return (process.env.TARGET_USERS ?? 'formulahendry')
    .split(',')
    .map((login) => login.trim())
    .filter(Boolean);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function cachePath(cacheKey: string): string {
  return join(cacheRoot, `${Buffer.from(cacheKey).toString('base64url')}.json`);
}

async function readCache<T>(cacheKey: string): Promise<T | null> {
  if (process.env.DISABLE_GITHUB_CACHE === 'true') {
    return null;
  }

  try {
    return JSON.parse(await readFile(cachePath(cacheKey), 'utf8')) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeCache(cacheKey: string, value: unknown): Promise<void> {
  if (process.env.DISABLE_GITHUB_CACHE === 'true') {
    return;
  }

  const filePath = cachePath(cacheKey);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function retryDelaySeconds(response: Response, attempt: number): number | null {
  if (response.status !== 403 && response.status !== 429) {
    return null;
  }

  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return retryAfter;
  }

  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  if (remaining === '0' && Number.isFinite(reset)) {
    return Math.max(reset - Math.floor(Date.now() / 1000) + 5, 5);
  }

  return Number(process.env.GITHUB_RETRY_BASE_SECONDS ?? '30') * attempt;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function githubJson<T>(pathOrUrl: string): Promise<T> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `https://api.github.com${pathOrUrl}`;
  const cached = await readCache<T>(url);
  if (cached) {
    return cached;
  }

  const maxRetries = Number(process.env.GITHUB_MAX_RETRIES ?? '5');
  const maxSleepSeconds = Number(process.env.GITHUB_MAX_SLEEP_SECONDS ?? '900');

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const response = await fetch(url, { headers });

    if (response.ok) {
      const result = (await response.json()) as T;
      await writeCache(url, result);
      return result;
    }

    const message = await response.text();
    const delaySeconds = retryDelaySeconds(response, attempt);
    if (delaySeconds !== null && attempt <= maxRetries) {
      const boundedDelay = Math.min(delaySeconds, maxSleepSeconds);
      console.warn(
        `GitHub API ${response.status} for ${url}; retrying in ${boundedDelay}s (${attempt}/${maxRetries}).`,
      );
      await sleep(boundedDelay * 1000);
      continue;
    }

    throw new Error(`GitHub API ${response.status} for ${url}: ${message}`);
  }

  throw new Error(`GitHub API retry loop exited unexpectedly for ${url}`);
}

async function getUser(login: string): Promise<GitHubUser> {
  return githubJson<GitHubUser>(`/users/${login}`);
}

async function listUserRepos(login: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubJson<GitHubRepo[]>(
      `/users/${login}/repos?type=owner&sort=updated&per_page=100&page=${page}`,
    );
    repos.push(...batch);
    if (batch.length < 100) {
      return repos;
    }
  }
}

async function getRepoLanguages(repo: GitHubRepo): Promise<Record<string, number>> {
  return githubJson<Record<string, number>>(repo.languages_url);
}

function ensureOwner(owners: Map<string, OwnerStats>, repo: GitHubRepo): OwnerStats {
  const existing = owners.get(repo.owner.login);
  if (existing) {
    return existing;
  }

  const owner: OwnerStats = {
    login: repo.owner.login,
    name: null,
    avatarUrl: repo.owner.avatar_url,
    htmlUrl: repo.owner.html_url,
    location: null,
    countryCode: null,
    profileHydrated: false,
    languages: new Map(),
  };
  owners.set(owner.login, owner);
  return owner;
}

function ensureLanguageStats(owner: OwnerStats, language: LanguageConfig): LanguageStats {
  const existing = owner.languages.get(language.slug);
  if (existing) {
    return existing;
  }

  const stats: LanguageStats = {
    starsPrimary: 0,
    repoCountPrimary: 0,
    starsContains: 0,
    repoCountContains: 0,
    topRepos: new Map(),
  };
  owner.languages.set(language.slug, stats);
  return stats;
}

function addRepo(owner: OwnerStats, language: LanguageConfig, repo: GitHubRepo, containsLanguage: boolean): void {
  if (repo.fork) {
    return;
  }

  const stats = ensureLanguageStats(owner, language);
  const topRepo: TopRepository = {
    name: repo.name,
    fullName: repo.full_name,
    stars: repo.stargazers_count,
    url: repo.html_url,
    primaryLanguage: repo.language,
  };

  if (repo.language === language.name) {
    stats.starsPrimary += repo.stargazers_count;
    stats.repoCountPrimary += 1;
  }

  if (containsLanguage) {
    stats.starsContains += repo.stargazers_count;
    stats.repoCountContains += 1;
  }

  if (repo.language === language.name || containsLanguage) {
    stats.topRepos.set(repo.full_name, topRepo);
  }
}

function mergeSeedUser(owners: Map<string, OwnerStats>): void {
  owners.set(seedUser.login, structuredCloneOwner(seedUser));
}

function structuredCloneOwner(owner: OwnerStats): OwnerStats {
  return {
    ...owner,
    languages: new Map(
      [...owner.languages.entries()].map(([slug, stats]) => [
        slug,
        {
          ...stats,
          topRepos: new Map(stats.topRepos),
        },
      ]),
    ),
  };
}

async function addTargetUser(owners: Map<string, OwnerStats>, login: string, languages: LanguageConfig[]): Promise<void> {
  const profile = await getUser(login);
  if (profile.type !== 'User') {
    return;
  }

  const owner: OwnerStats = {
    login: profile.login,
    name: profile.name,
    avatarUrl: profile.avatar_url,
    htmlUrl: profile.html_url,
    location: profile.location,
    countryCode: normalizeCountry(profile.location),
    profileHydrated: true,
    languages: new Map(),
  };

  const repos = (await listUserRepos(login)).filter((repo) => !repo.fork);
  for (const repo of repos) {
    const repoLanguages = await getRepoLanguages(repo);
    for (const language of languages) {
      addRepo(owner, language, repo, Object.prototype.hasOwnProperty.call(repoLanguages, language.name));
    }
  }

  owners.set(owner.login, owner);
}

function starQualifier(low: number, high: number): string {
  return `stars:${low}..${high}`;
}

function bucketKey(low: number, high: number): string {
  return `${low}..${high}`;
}

function bucketId(language: LanguageConfig, low: number, high: number): string {
  return `${language.slug}:${bucketKey(low, high)}`;
}

function statePath(languages: LanguageConfig[]): string {
  const minStars = Number(process.env.MIN_STARS ?? '100');
  const maxStars = Number(process.env.MAX_STARS ?? '250000');
  const languageKey = languages.map((language) => language.slug).join('-');
  return join(stateRoot, `${languageKey}-${minStars}-${maxStars}.json`);
}

function serializeOwner(owner: OwnerStats): SerializedOwnerStats {
  return {
    login: owner.login,
    name: owner.name,
    avatarUrl: owner.avatarUrl,
    htmlUrl: owner.htmlUrl,
    location: owner.location,
    countryCode: owner.countryCode,
    profileHydrated: owner.profileHydrated,
    languages: [...owner.languages.entries()].map(([slug, stats]) => [
      slug,
      {
        starsPrimary: stats.starsPrimary,
        repoCountPrimary: stats.repoCountPrimary,
        starsContains: stats.starsContains,
        repoCountContains: stats.repoCountContains,
        topRepos: [...stats.topRepos.values()],
      },
    ]),
  };
}

function deserializeOwner(owner: SerializedOwnerStats): OwnerStats {
  return {
    login: owner.login,
    name: owner.name,
    avatarUrl: owner.avatarUrl,
    htmlUrl: owner.htmlUrl,
    location: owner.location,
    countryCode: normalizeCountry(owner.location),
    profileHydrated: owner.profileHydrated,
    languages: new Map(
      owner.languages.map(([slug, stats]) => [
        slug,
        {
          starsPrimary: stats.starsPrimary,
          repoCountPrimary: stats.repoCountPrimary,
          starsContains: stats.starsContains,
          repoCountContains: stats.repoCountContains,
          topRepos: new Map(stats.topRepos.map((repo) => [repo.fullName, repo])),
        },
      ]),
    ),
  };
}

async function readRefreshState(languages: LanguageConfig[]): Promise<RefreshState | null> {
  if (process.env.RESET_REFRESH_STATE === 'true') {
    return null;
  }

  try {
    return JSON.parse(await readFile(statePath(languages), 'utf8')) as RefreshState;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeRefreshState(
  owners: Map<string, OwnerStats>,
  languages: LanguageConfig[],
  coverage: SearchBucketCoverage[],
): Promise<void> {
  const state: RefreshState = {
    version: 1,
    generatedAt: new Date().toISOString(),
    config: {
      languages: languages.map((language) => language.slug),
      minStars: Number(process.env.MIN_STARS ?? '100'),
      maxStars: Number(process.env.MAX_STARS ?? '250000'),
    },
    owners: [...owners.values()].map(serializeOwner),
    coverage,
  };
  const filePath = statePath(languages);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function searchLanguageRepos(
  language: LanguageConfig,
  low: number,
  high: number,
  page: number,
): Promise<SearchResponse> {
  const query = encodeURIComponent(`language:${language.githubQuery} fork:false ${starQualifier(low, high)}`);
  return githubJson<SearchResponse>(
    `/search/repositories?q=${query}&sort=stars&order=desc&per_page=100&page=${page}`,
  );
}

async function collectSearchBucket(
  owners: Map<string, OwnerStats>,
  languages: LanguageConfig[],
  language: LanguageConfig,
  low: number,
  high: number,
  coverage: SearchBucketCoverage[],
  completedBuckets: Set<string>,
): Promise<void> {
  const pagesPerBucket = Number(process.env.SEARCH_PAGES ?? '10');
  const bucketLimit = Number(process.env.SEARCH_BUCKET_LIMIT ?? '50');
  const currentBucketId = bucketId(language, low, high);

  if (coverage.length >= bucketLimit) {
    return;
  }

  if (completedBuckets.has(currentBucketId)) {
    return;
  }

  const firstPage = await searchLanguageRepos(language, low, high, 1);
  if (firstPage.total_count > 1000 && low < high) {
    const midpoint = Math.floor((low + high) / 2);
    await collectSearchBucket(owners, languages, language, midpoint + 1, high, coverage, completedBuckets);
    await collectSearchBucket(owners, languages, language, low, midpoint, coverage, completedBuckets);
    return;
  }

  const totalPages = Math.min(pagesPerBucket, Math.ceil(firstPage.total_count / 100));
  const items = [...firstPage.items];

  for (let page = 2; page <= totalPages; page += 1) {
    const result = await searchLanguageRepos(language, low, high, page);
    items.push(...result.items);
    if (result.items.length < 100) {
      break;
    }
  }

  for (const repo of items) {
    if (repo.owner.type !== 'User') {
      continue;
    }

    const owner = ensureOwner(owners, repo);
    addRepo(owner, language, repo, repo.language === language.name);
  }

  const bucketCoverage = {
    language: language.slug,
    stars: bucketKey(low, high),
    totalCount: firstPage.total_count,
    collectedRepos: items.length,
    truncated: items.length < firstPage.total_count,
  };
  coverage.push(bucketCoverage);
  completedBuckets.add(currentBucketId);
  await writeRefreshState(owners, languages, coverage);
}

async function collectSearchRepos(
  owners: Map<string, OwnerStats>,
  languages: LanguageConfig[],
  language: LanguageConfig,
  coverage: SearchBucketCoverage[],
  completedBuckets: Set<string>,
): Promise<void> {
  const minStars = Number(process.env.MIN_STARS ?? '100');
  const maxStars = Number(process.env.MAX_STARS ?? '250000');
  await collectSearchBucket(owners, languages, language, minStars, maxStars, coverage, completedBuckets);
}

async function hydrateOwnerProfiles(
  owners: Map<string, OwnerStats>,
  languages: LanguageConfig[],
  coverage: SearchBucketCoverage[],
): Promise<void> {
  const profileLimit = Number(process.env.OWNER_PROFILE_LIMIT ?? '1000');
  const ownerList = [...owners.values()]
    .sort((a, b) => maxLanguageStars(b, languages) - maxLanguageStars(a, languages))
    .slice(0, profileLimit);

  for (const [index, owner] of ownerList.entries()) {
    if (owner.profileHydrated) {
      continue;
    }

    const profile = await getUser(owner.login);
    owner.name = profile.name;
    owner.avatarUrl = profile.avatar_url;
    owner.htmlUrl = profile.html_url;
    owner.location = profile.location;
    owner.countryCode = normalizeCountry(profile.location);
    owner.profileHydrated = true;

    if (index % 25 === 0) {
      await writeRefreshState(owners, languages, coverage);
    }
  }

  await writeRefreshState(owners, languages, coverage);
}

function maxLanguageStars(owner: OwnerStats, languages: LanguageConfig[]): number {
  return Math.max(...languages.map((language) => owner.languages.get(language.slug)?.starsPrimary ?? 0));
}

function topRepos(stats: LanguageStats): TopRepository[] {
  return [...stats.topRepos.values()].sort((a, b) => b.stars - a.stars).slice(0, 5);
}

function toRankingItems(owners: OwnerStats[], language: LanguageConfig): RankingItem[] {
  return owners
    .map((owner) => ({ owner, stats: owner.languages.get(language.slug) }))
    .filter((entry): entry is { owner: OwnerStats; stats: LanguageStats } => Boolean(entry.stats))
    .filter((entry) => entry.stats.starsPrimary > 0)
    .sort((a, b) => b.stats.starsPrimary - a.stats.starsPrimary)
    .map((entry, index) => ({
      rank: index + 1,
      login: entry.owner.login,
      name: entry.owner.name,
      avatarUrl: entry.owner.avatarUrl,
      htmlUrl: entry.owner.htmlUrl,
      location: entry.owner.location,
      countryCode: entry.owner.countryCode,
      starsPrimary: entry.stats.starsPrimary,
      repoCountPrimary: entry.stats.repoCountPrimary,
      starsContains: entry.stats.starsContains,
      repoCountContains: entry.stats.repoCountContains,
      topRepos: topRepos(entry.stats),
    }));
}

function buildUserDataset(
  owner: OwnerStats,
  languages: LanguageConfig[],
  globalRankings: Map<string, RankingItem[]>,
  countryRankings: Map<string, RankingItem[]>,
  generatedAt: string,
  isPartial: boolean,
): UserDataset {
  const languageStats: UserLanguageStats[] = languages
    .map((language) => {
      const stats = owner.languages.get(language.slug);
      if (!stats) {
        return null;
      }

      return {
        language,
        starsPrimary: stats.starsPrimary,
        repoCountPrimary: stats.repoCountPrimary,
        starsContains: stats.starsContains,
        repoCountContains: stats.repoCountContains,
        globalRank: globalRankings.get(language.slug)?.find((item) => item.login === owner.login)?.rank ?? null,
        countryRank: countryRankings.get(language.slug)?.find((item) => item.login === owner.login)?.rank ?? null,
        topRepos: topRepos(stats),
      };
    })
    .filter((stats): stats is UserLanguageStats => Boolean(stats));

  return {
    login: owner.login,
    name: owner.name,
    avatarUrl: owner.avatarUrl,
    htmlUrl: owner.htmlUrl,
    location: owner.location,
    countryCode: owner.countryCode,
    generatedAt,
    isPartial,
    languages: languageStats,
  };
}

async function writeJson(relativePath: string, value: unknown): Promise<void> {
  const filePath = join(dataRoot, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function generateData(options: GenerateOptions = {}): Promise<void> {
  const generatedAt = new Date().toISOString();
  const languages = getLanguages();
  const owners = new Map<string, OwnerStats>();
  const isPartial = process.env.COMPLETE_DATASET !== 'true';
  const coverage: SearchBucketCoverage[] = [];
  const completedBuckets = new Set<string>();

  await rm(dataRoot, { recursive: true, force: true });
  await mkdir(dataRoot, { recursive: true });

  if (options.seedOnly) {
    mergeSeedUser(owners);
  } else {
    if (process.env.DISCOVER_RANKINGS === 'true') {
      const state = await readRefreshState(languages);
      if (state) {
        for (const owner of state.owners) {
          owners.set(owner.login, deserializeOwner(owner));
        }
        coverage.push(...state.coverage);
        for (const bucket of state.coverage) {
          completedBuckets.add(`${bucket.language}:${bucket.stars}`);
        }
      }
    }

    for (const login of getTargetUsers()) {
      await addTargetUser(owners, login, languages);
    }

    if (process.env.DISCOVER_RANKINGS === 'true') {
      for (const language of languages) {
        await collectSearchRepos(owners, languages, language, coverage, completedBuckets);
      }
      await hydrateOwnerProfiles(owners, languages, coverage);
    }
  }

  if (!owners.size) {
    mergeSeedUser(owners);
  }

  const allOwners = [...owners.values()];
  const globalRankings = new Map<string, RankingItem[]>();
  const countryRankings = new Map<string, RankingItem[]>();

  for (const language of languages) {
    const globalItems = toRankingItems(allOwners, language).slice(0, Number(process.env.GLOBAL_LIMIT ?? '500'));
    globalRankings.set(language.slug, globalItems);

    const dataset: RankingDataset = {
      language,
      scope: 'global',
      metric: 'starsPrimary',
      generatedAt,
      isPartial,
      methodology:
        'Primary metric: public non-fork repositories whose GitHub primary language matches the selected language.',
      items: globalItems,
    };
    await writeJson(`languages/${language.slug}.json`, dataset);

    for (const country of countries) {
      const countryItems = toRankingItems(
        allOwners.filter((owner) => owner.countryCode === country.code),
        language,
      ).slice(0, Number(process.env.COUNTRY_LIMIT ?? '200'));
      countryRankings.set(language.slug, countryItems);

      await writeJson(`countries/${country.slug}/${language.slug}.json`, {
        language,
        scope: 'country',
        country,
        metric: 'starsPrimary',
        generatedAt,
        isPartial,
        methodology:
          'Primary metric filtered to users whose public GitHub profile location normalizes to the selected region.',
        items: countryItems,
      } satisfies RankingDataset);
    }
  }

  for (const owner of allOwners) {
    await writeJson(
      `users/${owner.login}.json`,
      buildUserDataset(owner, languages, globalRankings, countryRankings, generatedAt, isPartial),
    );
  }

  const meta: SiteMeta = {
    generatedAt,
    isPartial,
    languages,
    countries,
    defaultLanguage: languages[0]?.slug ?? 'typescript',
    methodology:
      'Rankings use GitHub public API data. Country is inferred from free-form profile location and may be incomplete.',
  };
  await writeJson('meta.json', meta);

  await writeJson('coverage.json', {
    generatedAt,
    isPartial,
    minStars: Number(process.env.MIN_STARS ?? '100'),
    maxStars: Number(process.env.MAX_STARS ?? '250000'),
    searchPagesPerBucket: Number(process.env.SEARCH_PAGES ?? '10'),
    searchBucketLimit: Number(process.env.SEARCH_BUCKET_LIMIT ?? '50'),
    buckets: coverage,
  } satisfies CoverageReport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await generateData();
}
