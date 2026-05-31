export interface LanguageConfig {
  slug: string;
  name: string;
  githubQuery: string;
}

export interface CountryConfig {
  slug: string;
  name: string;
  code: string;
}

export interface TopRepository {
  name: string;
  fullName: string;
  stars: number;
  url: string;
  primaryLanguage: string | null;
}

export interface RankingItem {
  rank: number;
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
  location: string | null;
  countryCode: string | null;
  starsPrimary: number;
  repoCountPrimary: number;
  starsContains: number;
  repoCountContains: number;
  topRepos: TopRepository[];
}

export interface RankingDataset {
  language: LanguageConfig;
  scope: 'global' | 'country';
  country?: CountryConfig;
  metric: 'starsPrimary';
  generatedAt: string;
  isPartial: boolean;
  methodology: string;
  items: RankingItem[];
}

export interface UserLanguageStats {
  language: LanguageConfig;
  starsPrimary: number;
  repoCountPrimary: number;
  starsContains: number;
  repoCountContains: number;
  globalRank: number | null;
  countryRank: number | null;
  topRepos: TopRepository[];
}

export interface UserDataset {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
  location: string | null;
  countryCode: string | null;
  generatedAt: string;
  isPartial: boolean;
  languages: UserLanguageStats[];
}

export interface SiteMeta {
  generatedAt: string;
  isPartial: boolean;
  languages: LanguageConfig[];
  countries: CountryConfig[];
  defaultLanguage: string;
  methodology: string;
}
