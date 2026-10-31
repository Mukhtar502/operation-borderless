import { CURRENCY_CODES, type CurrencyCode } from '../domain/currencies.js';
import { Money } from '../domain/money.js';
import { quoteFrom, type RateSnapshot } from '../modules/rates/fx.service.js';

// Realistic, self-consistent examples for the API docs. Without them Swagger UI
// invents values from the schema alone (e.g. a DEPOSIT with a sender). A unit test
// parses every example with its schema, so they cannot drift from the real shapes.

const ADA = '3f6c2a7e-8b1d-4c5e-9a2f-1b7d6e4c8a90';
const KOFI = '9a1e4b2c-7d3f-4e6a-8b5c-2f1d0e9c7b64';
const REFRESHED_AT = '2026-10-30T09:14:52.000Z';
const PROVIDER_UPDATED_AT = '2026-10-30T00:02:31.000Z';

// Units per 1 USD, roughly in line with late-2026 reference rates.
const SAMPLE_RATES: Record<CurrencyCode, string> = {
  cNGN: '1346.236888',
  cGHS: '11.639916',
  cXAF: '588.52908',
  USDx: '1',
  EURx: '0.897215',
};
const sampleSnapshot: RateSnapshot = {
  source: 'live',
  provider: 'open.er-api.com',
  refreshedAt: new Date(REFRESHED_AT),
  providerUpdatedAt: new Date(PROVIDER_UPDATED_AT),
  usdRates: Object.fromEntries(
    CURRENCY_CODES.map((code) => [code, new Money(SAMPLE_RATES[code])]),
  ) as Record<CurrencyCode, Money>,
};

const deposit = {
  id: '6d0f4c1a-2b3e-4f5a-8c9d-0e1f2a3b4c5d',
  type: 'DEPOSIT',
  fromWalletId: null,
  toWalletId: ADA,
  source: { currency: 'USDx', amount: '100.000000' },
  destination: { currency: 'USDx', amount: '100.000000' },
  fx: { rate: '1', source: 'par', provider: null, refreshedAt: '2026-10-30T09:15:00.000Z' },
  createdAt: '2026-10-30T09:15:00.000Z',
};

const swap = {
  id: '7e1a5d2b-3c4f-4a6b-9d0e-1f2a3b4c5d6e',
  type: 'SWAP',
  fromWalletId: ADA,
  toWalletId: ADA,
  source: { currency: 'USDx', amount: '40.000000' },
  destination: { currency: 'cNGN', amount: '53849.475520' },
  fx: {
    rate: '1346.236888',
    source: 'live',
    provider: 'open.er-api.com',
    refreshedAt: REFRESHED_AT,
  },
  createdAt: '2026-10-30T09:16:10.000Z',
};

const transfer = {
  id: '8f2b6e3c-4d5a-4b7c-8e1f-2a3b4c5d6e7f',
  type: 'TRANSFER',
  fromWalletId: ADA,
  toWalletId: KOFI,
  source: { currency: 'USDx', amount: '20.000000' },
  destination: { currency: 'cGHS', amount: '232.798320' },
  fx: { rate: '11.639916', source: 'live', provider: 'open.er-api.com', refreshedAt: REFRESHED_AT },
  createdAt: '2026-10-30T09:17:45.000Z',
};

const balances = [
  { currency: 'cNGN', amount: '53849.475520', usdValue: '40.000000' },
  { currency: 'cGHS', amount: '0.000000', usdValue: '0.000000' },
  { currency: 'cXAF', amount: '0.000000', usdValue: '0.000000' },
  { currency: 'USDx', amount: '40.000000', usdValue: '40.000000' },
  { currency: 'EURx', amount: '0.000000', usdValue: '0.000000' },
];

const withDirection = (tx: typeof transfer | typeof deposit, direction: string) => {
  const { id, type, ...rest } = tx;
  return { id, type, direction, ...rest };
};

/** Response examples, keyed by the component they illustrate. */
export const EXAMPLES = {
  WalletResponse: {
    data: {
      id: ADA,
      email: 'ada@example.com',
      phone: '+2348012345678',
      totalUsd: '80.000000',
      balances: balances.map(({ currency, amount }) => ({ currency, amount })),
      createdAt: '2026-10-30T09:14:00.000Z',
    },
  },
  WalletBalancesResponse: {
    data: {
      walletId: ADA,
      totalUsd: '80.000000',
      fx: {
        source: 'live',
        provider: 'open.er-api.com',
        refreshedAt: REFRESHED_AT,
        providerUpdatedAt: PROVIDER_UPDATED_AT,
      },
      balances,
    },
  },
  RatesResponse: {
    data: {
      source: 'live',
      provider: 'open.er-api.com',
      refreshedAt: REFRESHED_AT,
      providerUpdatedAt: PROVIDER_UPDATED_AT,
      rates: CURRENCY_CODES.flatMap((from) =>
        CURRENCY_CODES.filter((to) => to !== from).map((to) => ({
          from,
          to,
          rate: quoteFrom(sampleSnapshot, from, to).rate.toFixed(),
          refreshedAt: REFRESHED_AT,
          providerUpdatedAt: PROVIDER_UPDATED_AT,
        })),
      ),
    },
  },
  DepositResponse: { data: deposit },
  SwapResponse: { data: swap },
  TransferResponse: { data: transfer },
  TransactionHistory: {
    data: [withDirection(transfer, 'OUT'), withDirection(deposit, 'IN')],
    pagination: {
      limit: 2,
      hasMore: true,
      nextCursor: 'NmQwZjRjMWEtMmIzZS00ZjVhLThjOWQtMGUxZjJhM2I0YzVk',
    },
  },
};

export const ERROR_EXAMPLES = {
  validation: {
    code: 'VALIDATION_ERROR',
    message: 'currency must be one of: cNGN, cGHS, cXAF, USDx, EURx',
    details: [
      { path: 'currency', message: 'currency must be one of: cNGN, cGHS, cXAF, USDx, EURx' },
    ],
  },
  walletNotFound: { code: 'WALLET_NOT_FOUND', message: 'Wallet not found' },
  transactionNotFound: { code: 'TRANSACTION_NOT_FOUND', message: 'Transaction not found' },
  walletExists: {
    code: 'WALLET_ALREADY_EXISTS',
    message: 'A wallet with this email already exists',
  },
  insufficientFunds: {
    code: 'INSUFFICIENT_FUNDS',
    message: 'Insufficient USDx balance',
    details: { currency: 'USDx', available: '10.000000', required: '25.000000' },
  },
  invalidCursor: { code: 'INVALID_CURSOR', message: 'cursor is not valid' },
};

export const errorExample = (error: Record<string, unknown>) => ({
  error: { ...error, requestId: '5b2c7d1e-9f3a-4e8b-a6c4-1d2e3f4a5b6c' },
});
