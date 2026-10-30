import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ERROR_EXAMPLES, errorExample, EXAMPLES } from '../../src/docs/examples.js';
import { OPENAPI_PATH } from '../../src/docs/generate.js';
import { buildOpenApiDocument } from '../../src/docs/openapi.js';
import {
  ErrorResponse,
  HistoryPage,
  RatesResponse,
  TransactionResponse,
  WalletBalancesResponse,
  WalletResponse,
} from '../../src/docs/schemas.js';

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

  it('every example matches the schema it illustrates', () => {
    const checks: [string, z.ZodType, unknown][] = [
      ['WalletResponse', WalletResponse, EXAMPLES.WalletResponse],
      ['WalletBalancesResponse', WalletBalancesResponse, EXAMPLES.WalletBalancesResponse],
      ['RatesResponse', RatesResponse, EXAMPLES.RatesResponse],
      ['DepositResponse', TransactionResponse, EXAMPLES.DepositResponse],
      ['SwapResponse', TransactionResponse, EXAMPLES.SwapResponse],
      ['TransferResponse', TransactionResponse, EXAMPLES.TransferResponse],
      ['TransactionHistory', HistoryPage, EXAMPLES.TransactionHistory],
      ...Object.entries(ERROR_EXAMPLES).map(
        ([name, example]) =>
          [name, ErrorResponse, errorExample(example)] as [string, z.ZodType, unknown],
      ),
    ];
    for (const [name, schema, example] of checks) {
      expect(schema.safeParse(example).error?.issues ?? [], name).toEqual([]);
    }
    expect(EXAMPLES.RatesResponse.data.rates).toHaveLength(20);
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
