import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OPENAPI_PATH } from '../../src/docs/generate.js';
import { buildOpenApiDocument } from '../../src/docs/openapi.js';

describe('OpenAPI document', () => {
  it('committed docs/openapi.json is up to date (run `yarn docs:openapi` to refresh)', () => {
    const committed: unknown = JSON.parse(readFileSync(OPENAPI_PATH, 'utf8'));
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildOpenApiDocument())));
  });

  it('every $ref points to a defined component', () => {
    const doc = buildOpenApiDocument();
    const refs = JSON.stringify(doc).match(/#\/components\/schemas\/\w+/g) ?? [];
    const defined = Object.keys(doc.components.schemas);
    for (const ref of new Set(refs)) {
      expect(defined).toContain(ref.split('/').at(-1));
    }
  });

  it('documents an Idempotency-Key header on every money-moving endpoint', () => {
    const { paths } = buildOpenApiDocument();
    for (const path of [
      '/v1/wallets/{walletId}/deposits',
      '/v1/wallets/{walletId}/swaps',
      '/v1/transfers',
    ] as const) {
      const names = paths[path].post.parameters.map((p) => p.name);
      expect(names, path).toContain('Idempotency-Key');
    }
  });
});
