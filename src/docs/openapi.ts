import { z } from 'zod';
import { depositBody, swapBody, transferBody } from '../modules/payments/payment.routes.js';
import { historyQuery } from '../modules/transactions/transaction.routes.js';
import { createWalletBody } from '../modules/wallets/wallet.routes.js';
import { ERROR_EXAMPLES, errorExample, EXAMPLES } from './examples.js';
import './schemas.js'; // registers the named response schemas used below

type JsonSchema = Record<string, unknown>;

/**
 * Every schema given an id with .meta({ id }) becomes an OpenAPI component. Zod converts
 * the whole registry in one go and links schemas to each other with $refs.
 */
function componentSchemas(): Record<string, JsonSchema> {
  const { schemas } = z.toJSONSchema(z.globalRegistry, {
    uri: (id) => `#/components/schemas/${id}`,
    unrepresentable: 'any',
  });
  return Object.fromEntries(
    Object.entries(schemas).map(([id, { $schema: _dialect, $id: _id, ...schema }]) => [id, schema]),
  );
}

/** Request schemas are described as the client sends them (before defaults apply). */
function inputSchema(schema: z.ZodType): JsonSchema {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
  });
  return rest;
}

const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` });

const json = (id: string, example: unknown) => ({
  'application/json': { schema: ref(id), example },
});

const requestBody = (schema: z.ZodType, example: unknown) => ({
  required: true,
  content: { 'application/json': { schema: inputSchema(schema), example } },
});

const error = (description: string, example: Record<string, unknown>) => ({
  description,
  content: json('Error', errorExample(example)),
});

const walletIdParam = {
  name: 'walletId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

const idempotencyHeader = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  description:
    'Unique per request (a UUID is recommended). Retrying with the same key and body ' +
    'replays the first response; the money moves once.',
  schema: { type: 'string', minLength: 1, maxLength: 255 },
};

const moneyErrors = {
  400: error('Invalid input, or missing Idempotency-Key', ERROR_EXAMPLES.validation),
  404: error('Wallet not found', ERROR_EXAMPLES.walletNotFound),
  422: error(
    'INSUFFICIENT_FUNDS, AMOUNT_TOO_SMALL, or IDEMPOTENCY_KEY_REUSED (same key, different body)',
    ERROR_EXAMPLES.insufficientFunds,
  ),
};

const transactionCreated = (description: string, example: unknown) => ({
  description,
  headers: {
    'Idempotent-Replayed': {
      description: 'true when this response was replayed from an earlier request with the same key',
      schema: { type: 'string', enum: ['true', 'false'] },
    },
  },
  content: json('TransactionResponse', example),
});

function queryParameters(schema: z.ZodType) {
  const { properties = {} } = inputSchema(schema) as { properties?: JsonSchema };
  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    in: 'query',
    required: false,
    schema: propertySchema,
  }));
}

export function buildOpenApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'CurrencyMesh API',
      version: '1.0.0',
      description:
        'Sandbox API for cross-border stablecoin payments: multi-currency wallets, ' +
        'deposits, FX swaps and transfers across cNGN, cGHS, cXAF, USDx and EURx.\n\n' +
        'Amounts are decimal strings (e.g. "100.50"), never JSON numbers. Every request ' +
        'that moves money requires an Idempotency-Key header.',
    },
    servers: [{ url: 'http://localhost:3000' }],
    tags: [
      { name: 'Wallets' },
      { name: 'Payments', description: 'Deposits, swaps and transfers' },
      { name: 'Transactions' },
      { name: 'FX' },
      { name: 'Health' },
    ],
    paths: {
      '/v1/wallets': {
        post: {
          tags: ['Wallets'],
          summary: 'Create a wallet',
          description:
            'Needs an email, a phone in international format, or both. Each email and phone ' +
            'can own only one wallet. Starts with a zero balance in every currency.',
          requestBody: requestBody(createWalletBody, { email: 'ada@example.com' }),
          responses: {
            201: {
              description: 'Wallet created',
              content: json('WalletResponse', EXAMPLES.WalletResponse),
            },
            400: error('Invalid email or phone', ERROR_EXAMPLES.validation),
            409: error('WALLET_ALREADY_EXISTS', ERROR_EXAMPLES.walletExists),
          },
        },
      },
      '/v1/wallets/{walletId}': {
        get: {
          tags: ['Wallets'],
          summary: 'Get a wallet with its balances and total in USD',
          description:
            'The summary view: who owns the wallet, what it holds, and the total in USD. ' +
            'For the USD value of each balance and the rates used, see /balances.',
          parameters: [walletIdParam],
          responses: {
            200: {
              description: 'The wallet',
              content: json('WalletResponse', EXAMPLES.WalletResponse),
            },
            404: error('Wallet not found', ERROR_EXAMPLES.walletNotFound),
          },
        },
      },
      '/v1/wallets/{walletId}/balances': {
        get: {
          tags: ['Wallets'],
          summary: 'Get the USD breakdown of every balance',
          description:
            'The breakdown view: each balance valued in USDx at the current rate, the total, ' +
            'and which rates were used (source and refresh time). All lines use one rate ' +
            'snapshot, and totalUsd is the sum of the lines.',
          parameters: [walletIdParam],
          responses: {
            200: {
              description: 'Balances',
              content: json('WalletBalancesResponse', EXAMPLES.WalletBalancesResponse),
            },
            404: error('Wallet not found', ERROR_EXAMPLES.walletNotFound),
          },
        },
      },
      '/v1/wallets/{walletId}/deposits': {
        post: {
          tags: ['Payments'],
          summary: 'Deposit funds (simulated)',
          parameters: [walletIdParam, idempotencyHeader],
          requestBody: requestBody(depositBody, { currency: 'cNGN', amount: '5000.50' }),
          responses: {
            201: transactionCreated('Deposit recorded', EXAMPLES.DepositResponse),
            ...moneyErrors,
          },
        },
      },
      '/v1/wallets/{walletId}/swaps': {
        post: {
          tags: ['Payments'],
          summary: 'Swap one stablecoin for another in the same wallet',
          description:
            'Converts at the current FX rate. The received amount is rounded down to 6 ' +
            'decimal places, so a swap never creates money.',
          parameters: [walletIdParam, idempotencyHeader],
          requestBody: requestBody(swapBody, {
            fromCurrency: 'USDx',
            toCurrency: 'cNGN',
            amount: '40',
          }),
          responses: {
            201: transactionCreated('Swap recorded', EXAMPLES.SwapResponse),
            ...moneyErrors,
          },
        },
      },
      '/v1/transfers': {
        post: {
          tags: ['Payments'],
          summary: 'Send funds to another wallet',
          description:
            'destinationCurrency is optional and defaults to sourceCurrency. When the ' +
            'currencies differ the amount is converted at the current FX rate.',
          parameters: [idempotencyHeader],
          requestBody: requestBody(transferBody, {
            fromWalletId: '3f6c2a7e-8b1d-4c5e-9a2f-1b7d6e4c8a90',
            toWalletId: '9a1e4b2c-7d3f-4e6a-8b5c-2f1d0e9c7b64',
            sourceCurrency: 'USDx',
            destinationCurrency: 'cGHS',
            amount: '20',
          }),
          responses: {
            201: transactionCreated('Transfer recorded', EXAMPLES.TransferResponse),
            ...moneyErrors,
          },
        },
      },
      '/v1/wallets/{walletId}/transactions': {
        get: {
          tags: ['Transactions'],
          summary: "List a wallet's transactions, newest first",
          description:
            'Deposits, swaps, and transfers sent and received. Uses cursor pagination: pass ' +
            'pagination.nextCursor back as ?cursor= for the next page.',
          parameters: [walletIdParam, ...queryParameters(historyQuery)],
          responses: {
            200: {
              description: 'One page of history',
              content: json('TransactionHistory', EXAMPLES.TransactionHistory),
            },
            400: error('Invalid query or cursor', ERROR_EXAMPLES.invalidCursor),
            404: error('Wallet not found', ERROR_EXAMPLES.walletNotFound),
          },
        },
      },
      '/v1/transactions/{transactionId}': {
        get: {
          tags: ['Transactions'],
          summary: 'Get one transaction',
          parameters: [
            {
              name: 'transactionId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            200: {
              description: 'The transaction',
              content: json('TransactionResponse', EXAMPLES.TransferResponse),
            },
            404: error('Transaction not found', ERROR_EXAMPLES.transactionNotFound),
          },
        },
      },
      '/v1/rates': {
        get: {
          tags: ['FX'],
          summary: 'Current rates between all supported stablecoins',
          description:
            'All 20 pairs, each with the time it was last refreshed. If the live provider ' +
            'is down, the last good (stale) or built-in (static) rates are served instead.',
          responses: {
            200: { description: 'Rates', content: json('RatesResponse', EXAMPLES.RatesResponse) },
          },
        },
      },
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Liveness check',
          responses: { 200: { description: 'The process is running' } },
        },
      },
      '/ready': {
        get: {
          tags: ['Health'],
          summary: 'Readiness check',
          responses: {
            200: { description: 'The database is reachable' },
            503: { description: 'The database is not reachable' },
          },
        },
      },
    },
    components: { schemas: componentSchemas() },
  };
}
