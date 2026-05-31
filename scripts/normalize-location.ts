const countryMatchers: Array<{ code: string; patterns: RegExp[] }> = [
  {
    code: 'CN',
    patterns: [
      /\bchina\b/i,
      /\bprc\b/i,
      /\bshanghai\b/i,
      /\bbeijing\b/i,
      /\bshenzhen\b/i,
      /\bhangzhou\b/i,
      /\bguangzhou\b/i,
      /\bnanjing\b/i,
      /\bchengdu\b/i,
      /\bwuhan\b/i,
      /\bxi'?an\b/i,
      /\bchongqing\b/i,
      /中国/,
      /上海/,
      /北京/,
      /深圳/,
      /杭州/,
      /广州/,
      /南京/,
      /成都/,
      /武汉/,
      /西安/,
      /重庆/,
    ],
  },
  {
    code: 'US',
    patterns: [/\busa\b/i, /\bunited states\b/i, /\bus\b/i, /\bsf\b/i, /\bnew york\b/i],
  },
  {
    code: 'SG',
    patterns: [/\bsingapore\b/i, /\bsg\b/i, /新加坡/],
  },
];

export function normalizeCountry(location: string | null | undefined): string | null {
  if (!location) {
    return null;
  }

  const normalized = location.trim();
  for (const country of countryMatchers) {
    if (country.patterns.some((pattern) => pattern.test(normalized))) {
      return country.code;
    }
  }

  return null;
}
