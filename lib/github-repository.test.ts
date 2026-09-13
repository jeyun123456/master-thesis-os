import { describe, expect, it } from 'vitest';
import { normalizeGithubRepository } from './github';

describe('GitHub repository identifier normalization', () => {
  const supported = [
    ['https://github.com/openai/codex', 'openai/codex'],
    ['https://github.com/openai/codex.git', 'openai/codex'],
    ['https://github.com/openai/codex/', 'openai/codex'],
    ['git@github.com:openai/codex.git', 'openai/codex'],
    ['openai/codex', 'openai/codex'],
  ] as const;

  it.each(supported)('normalizes %s', (input, expected) => {
    expect(normalizeGithubRepository(input)).toBe(expected);
  });

  it.each([
    undefined,
    '',
    'not-a-repository',
    'https://gitlab.com/openai/codex',
    'https://github.com/openai/codex/issues',
    'git@github.com:openai',
  ])('rejects malformed input %s', (input) => {
    expect(normalizeGithubRepository(input)).toBeNull();
  });
});
