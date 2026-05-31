// @ts-check
import { defineConfig } from 'astro/config';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'github-creator-ranking';
const base = process.env.BASE_PATH ?? (process.env.GITHUB_ACTIONS ? `/${repositoryName}` : '/');
const site = process.env.SITE ?? 'https://formulahendry.github.io';

// https://astro.build/config
export default defineConfig({
  site,
  base,
});
