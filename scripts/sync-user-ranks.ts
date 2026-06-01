import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RankingDataset, UserDataset } from '../src/lib/types';

const dataRoot = fileURLToPath(new URL('../public/data/', import.meta.url));

function rankKey(languageSlug: string, countryCode: string): string {
  return `${languageSlug}:${countryCode}`;
}

async function readJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(join(dataRoot, relativePath), 'utf8')) as T;
}

async function writeJson(relativePath: string, value: unknown): Promise<void> {
  await writeFile(join(dataRoot, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

async function listJsonFiles(relativeDir: string): Promise<string[]> {
  try {
    return (await readdir(join(dataRoot, relativeDir)))
      .filter((fileName) => fileName.endsWith('.json'))
      .map((fileName) => `${relativeDir}/${fileName}`);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function buildRankLookup(items: RankingDataset['items']): Map<string, number> {
  return new Map(items.map((item) => [item.login, item.rank]));
}

async function loadGlobalRanks(): Promise<Map<string, Map<string, number>>> {
  const ranks = new Map<string, Map<string, number>>();

  for (const filePath of await listJsonFiles('languages')) {
    const dataset = await readJson<RankingDataset>(filePath);
    ranks.set(dataset.language.slug, buildRankLookup(dataset.items));
  }

  return ranks;
}

async function loadCountryRanks(): Promise<Map<string, Map<string, number>>> {
  const ranks = new Map<string, Map<string, number>>();
  let countryDirs: string[];

  try {
    countryDirs = await readdir(join(dataRoot, 'countries'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return ranks;
    }
    throw error;
  }

  for (const countryDir of countryDirs) {
    for (const filePath of await listJsonFiles(`countries/${countryDir}`)) {
      const dataset = await readJson<RankingDataset>(filePath);
      if (dataset.country?.code) {
        ranks.set(rankKey(dataset.language.slug, dataset.country.code), buildRankLookup(dataset.items));
      }
    }
  }

  return ranks;
}

export async function syncUserRanks(): Promise<void> {
  const globalRanks = await loadGlobalRanks();
  const countryRanks = await loadCountryRanks();
  const userFiles = await listJsonFiles('users');
  let updatedFiles = 0;

  for (const filePath of userFiles) {
    const user = await readJson<UserDataset>(filePath);
    let changed = false;

    for (const languageStats of user.languages) {
      const languageSlug = languageStats.language.slug;
      const nextGlobalRank = globalRanks.get(languageSlug)?.get(user.login) ?? null;
      const nextCountryRank = user.countryCode
        ? (countryRanks.get(rankKey(languageSlug, user.countryCode))?.get(user.login) ?? null)
        : null;

      if (languageStats.globalRank !== nextGlobalRank) {
        languageStats.globalRank = nextGlobalRank;
        changed = true;
      }

      if (languageStats.countryRank !== nextCountryRank) {
        languageStats.countryRank = nextCountryRank;
        changed = true;
      }
    }

    if (changed) {
      await writeJson(filePath, user);
      updatedFiles += 1;
    }
  }

  console.log(`Synced user ranks: ${updatedFiles} of ${userFiles.length} user files updated.`);
}

await syncUserRanks();
