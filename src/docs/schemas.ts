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
const RefreshedAt = Timestamp.meta({
  description: 'When this API last fetched the rate successfully',
  example: '2026-10-30T09:14:52.000Z',
});
const ProviderUpdatedAt = Timestamp.meta({
  description: 'When the FX provider published the rate; its feed updates daily',
  example: '2026-10-30T00:02:31.000Z',
});
const Uuid = z.uuid().meta({ example: '3f6c2a7e-8b1d-4c5e-9a2f-1b7d6e4c8a90' });
const RateSource = z.enum(['live', 'stale', 'static']).meta({
  description: 'live: fetched recently; stale: last good rates; static: built-in table',
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
    totalUsd: Amount.meta({
      description: 'All balances valued in USD at current rates; see /balances for the breakdown',
      example: '3.900889',
    }),
    balances: z.array(Balance),
    createdAt: Timestamp,
  })
  .meta({ id: 'Wallet' });

export const WalletBalances = z
  .strictObject({
    walletId: Uuid,
    totalUsd: Amount.meta({ description: 'Sum of the usdValue lines', example: '3.900889' }),
    fx: z.strictObject({
      source: RateSource,
      provider: z.string(),
      refreshedAt: RefreshedAt,
      providerUpdatedAt: ProviderUpdatedAt,
    }),
    balances: z.array(Balance.extend({ usdValue: Amount })),
  })
  .meta({ id: 'WalletBalances' });

export const Rates = z
  .strictObject({
    source: RateSource,
    provider: z.string().meta({ example: 'open.er-api.com' }),
    refreshedAt: RefreshedAt,
    providerUpdatedAt: ProviderUpdatedAt,
    rates: z.array(
      z.strictObject({
        from: Currency,
        to: Currency,
        rate: Rate,
        refreshedAt: RefreshedAt,
        providerUpdatedAt: ProviderUpdatedAt,
      }),
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

// Same fields as Transaction, with direction placed right after type, as the API sends it.
const { id: txId, type: txType, ...txRest } = Transaction.shape;
const HistoryItem = z.strictObject({
  id: txId,
  type: txType,
  direction: z
    .enum(['IN', 'OUT', 'INTERNAL'])
    .meta({ description: 'From the point of view of the wallet being listed' }),
  ...txRest,
});

export const HistoryPage = z
  .strictObject({
    data: z.array(HistoryItem),
    pagination: z.strictObject({
      limit: z.number().int().min(1).max(100).meta({ example: 20 }),
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
