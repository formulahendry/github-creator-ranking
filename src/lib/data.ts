import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { RankingDataset, SiteMeta, UserDataset } from './types';

const dataRoot = join(process.cwd(), 'public/data');

function readJson<T>(relativePath: string): T {
  const filePath = join(dataRoot, relativePath);
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

export function getMeta(): SiteMeta {
  return readJson<SiteMeta>('meta.json');
}

export function getLanguageRanking(language: string): RankingDataset {
  return readJson<RankingDataset>(`languages/${language}.json`);
}

export function getCountryRanking(country: string, language: string): RankingDataset {
  return readJson<RankingDataset>(`countries/${country}/${language}.json`);
}

export function getUserDataset(login: string): UserDataset {
  return readJson<UserDataset>(`users/${login}.json`);
}

export function listUserLogins(): string[] {
  const usersDir = join(dataRoot, 'users');
  if (!existsSync(usersDir)) {
    return [];
  }

  return readdirSync(usersDir)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => fileName.replace(/\.json$/, ''));
}
