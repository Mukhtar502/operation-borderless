import { z } from 'zod';
import { CURRENCY_CODES } from '../domain/currencies.js';

// Response shapes, written once and used twice: to generate the OpenAPI spec, and by
// the contract tests that parse real API responses with them. Strict objects make an
// undocumented field fail those tests, so the docs cannot silently drift from the code.

const Currency = z.enum(CURRENCY_CODES).meta({ example: 'cNGN' });
const Amount = z
  .string()
  .regex(/^-?\d+\.\d{6}$/)
  .meta({ description: 'Decimal string at 6 decimal places', example: '5000.500000' });
const Rate = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .meta({ description: 'Units of the target currency per 1 unit of the source', example: '1500' });
const Timestamp = z.iso.datetime().meta({ example: '2026-10-30T09:15:00.000Z' });
const Uuid = z.uuid().meta({ example: '3f6c2a7e-8b1d-4c5e-9a2f-1b7d6e4c8a90' });
const RateSource = z.enum(['live', 'stale', 'static']).meta({
  description: 'live: fresh from provider; stale: last good rates; static: built-in table',
});

export const ErrorResponse = z
  .strictObject({
    error: z.strictObject({
      code: z.string().meta({ example: 'INSUFFICIENT_FUNDS' }),
      message: z.string().meta({ example: 'Insufficient USDx balance' }),
      details: z.unknown().optional(),
      requestId: z.string(),
    }),
  })
  .meta({ id: 'Error' });

export const Balance = z
  .strictObject({ currency: Currency, amount: Amount })
  .meta({ id: 'Balance' });

export const Wallet = z
  .strictObject({
    id: Uuid,
    email: z.string().nullable().meta({ example: 'ada@example.com' }),
    phone: z.string().nullable().meta({ example: '+2348012345678' }),
    balances: z.array(Balance),
    createdAt: Timestamp,
  })
  .meta({ id: 'Wallet' });

export const WalletBalances = z
  .strictObject({
    walletId: Uuid,
    balances: z.array(Balance.extend({ usdValue: Amount })),
    totalUsd: Amount,
    fx: z.strictObject({ source: RateSource, provider: z.string(), refreshedAt: Timestamp }),
  })
  .meta({ id: 'WalletBalances' });

export const Rates = z
  .strictObject({
    source: RateSource,
    provider: z.string().meta({ example: 'open.er-api.com' }),
    refreshedAt: Timestamp,
    rates: z.array(
      z.strictObject({ from: Currency, to: Currency, rate: Rate, refreshedAt: Timestamp }),
    ),
  })
  .meta({ id: 'Rates' });

export const Transaction = z
  .strictObject({
    id: Uuid,
    type: z.enum(['DEPOSIT', 'SWAP', 'TRANSFER']),
    fromWalletId: Uuid.nullable().meta({ description: 'null for deposits' }),
    toWalletId: Uuid,
    source: z.strictObject({ currency: Currency, amount: Amount }),
    destination: z.strictObject({ currency: Currency, amount: Amount }),
    fx: z.strictObject({
      rate: Rate,
      source: z
        .enum(['par', 'live', 'stale', 'static'])
        .meta({ description: '"par" when no conversion happened' }),
      provider: z.string().nullable(),
      refreshedAt: Timestamp,
    }),
    createdAt: Timestamp,
  })
  .meta({ id: 'Transaction' });

export const HistoryPage = z
  .strictObject({
    data: z.array(
      Transaction.extend({
        direction: z
          .enum(['IN', 'OUT', 'INTERNAL'])
          .meta({ description: 'From the point of view of the wallet being listed' }),
      }),
    ),
    pagination: z.strictObject({
      limit: z.number().int(),
      hasMore: z.boolean(),
      nextCursor: z
        .string()
        .nullable()
        .meta({ description: 'Pass as ?cursor= to get the next page; null on the last page' }),
    }),
  })
  .meta({ id: 'TransactionHistory' });

// Success responses wrap their payload in { data }.
const envelope = <T extends z.ZodType>(schema: T, id: string) =>
  z.strictObject({ data: schema }).meta({ id });

export const WalletResponse = envelope(Wallet, 'WalletResponse');
export const WalletBalancesResponse = envelope(WalletBalances, 'WalletBalancesResponse');
export const RatesResponse = envelope(Rates, 'RatesResponse');
export const TransactionResponse = envelope(Transaction, 'TransactionResponse');
