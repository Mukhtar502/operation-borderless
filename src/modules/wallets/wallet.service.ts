import { Decimal } from 'decimal.js';
import type { DB } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { CURRENCIES, CURRENCY_CODES, type CurrencyCode } from '../../domain/currencies.js';
import { normalizeEmail, normalizePhone } from '../../domain/identifiers.js';
import { Money } from '../../domain/money.js';
import { conflict, notFound } from '../../lib/errors.js';
import { quoteFrom, type FxService, type RateSource } from '../rates/fx.service.js';

export interface Balance {
  currency: CurrencyCode;
  amount: string;
}

/** The breakdown: how each balance converts to USD and which rates were used. */
export interface WalletBalances {
  walletId: string;
  /** Sum of the usdValue lines, in USDx at USDx precision. */
  totalUsd: string;
  fx: { source: RateSource; provider: string; refreshedAt: Date; providerUpdatedAt: Date };
  balances: (Balance & { usdValue: string })[];
}

/** The summary: who owns the wallet, what it holds and what that is worth in USD. */
export interface WalletView {
  id: string;
  email: string | null;
  phone: string | null;
  totalUsd: string;
  balances: Balance[];
  createdAt: Date;
}

export interface CreateWalletInput {
  email?: string | undefined;
  phone?: string | undefined;
}

export class WalletService {
  constructor(
    private readonly db: DB,
    private readonly fx: FxService,
  ) {}

  /** Creates the wallet and one zero-balance account per currency in one transaction. */
  async create(input: CreateWalletInput): Promise<WalletView> {
    const email = input.email === undefined ? null : normalizeEmail(input.email);
    const phone = input.phone === undefined ? null : normalizePhone(input.phone);

    try {
      const walletId = await this.db.transaction().execute(async (trx) => {
        const wallet = await trx
          .insertInto('wallets')
          .values({ email, phone })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('accounts')
          .values(
            CURRENCY_CODES.map((currency) => ({ wallet_id: wallet.id, kind: 'WALLET', currency })),
          )
          .execute();
        return wallet.id;
      });
      return await this.get(walletId);
    } catch (err) {
      // The unique constraints, not a "check then insert", decide duplicates. That stays
      // correct when two requests for the same email arrive at the same moment.
      if (isUniqueViolation(err, 'wallets_email_key')) {
        throw conflict('WALLET_ALREADY_EXISTS', 'A wallet with this email already exists');
      }
      if (isUniqueViolation(err, 'wallets_phone_key')) {
        throw conflict('WALLET_ALREADY_EXISTS', 'A wallet with this phone already exists');
      }
      throw err;
    }
  }

  async get(walletId: string): Promise<WalletView> {
    const wallet = await this.db
      .selectFrom('wallets')
      .select(['id', 'email', 'phone', 'created_at'])
      .where('id', '=', walletId)
      .executeTakeFirst();
    if (!wallet) throw notFound('WALLET_NOT_FOUND', 'Wallet not found');

    return {
      id: wallet.id,
      email: wallet.email,
      phone: wallet.phone,
      ...(await this.summarise(walletId)),
      createdAt: wallet.created_at,
    };
  }

  async getBalances(walletId: string): Promise<WalletBalances> {
    const exists = await this.db
      .selectFrom('wallets')
      .select('id')
      .where('id', '=', walletId)
      .executeTakeFirst();
    if (!exists) throw notFound('WALLET_NOT_FOUND', 'Wallet not found');

    const { totalUsd, snapshot, lines } = await this.valueInUsd(walletId);
    return {
      walletId,
      totalUsd,
      fx: {
        source: snapshot.source,
        provider: snapshot.provider,
        refreshedAt: snapshot.refreshedAt,
        providerUpdatedAt: snapshot.providerUpdatedAt,
      },
      balances: lines,
    };
  }

  private async summarise(walletId: string): Promise<Pick<WalletView, 'totalUsd' | 'balances'>> {
    const { totalUsd, lines } = await this.valueInUsd(walletId);
    return { totalUsd, balances: lines.map(({ currency, amount }) => ({ currency, amount })) };
  }

  /**
   * Values every balance in USDx. Balances are read straight from the database (never
   * cached), and every line uses the same rate snapshot. Each line is rounded half-even
   * to USDx precision and the total is the sum of the lines, so the numbers a client
   * sees always add up.
   */
  private async valueInUsd(walletId: string) {
    const [balances, snapshot] = await Promise.all([
      this.loadBalances(walletId),
      this.fx.getSnapshot(),
    ]);
    const usdDecimals = CURRENCIES.USDx.decimals;

    let total = new Money(0);
    const lines = balances.map((balance) => {
      const { rate } = quoteFrom(snapshot, balance.currency, 'USDx');
      const usdValue = new Money(balance.amount)
        .times(rate)
        .toDecimalPlaces(usdDecimals, Decimal.ROUND_HALF_EVEN);
      total = total.plus(usdValue);
      return { ...balance, usdValue: usdValue.toFixed(usdDecimals) };
    });

    return { totalUsd: total.toFixed(usdDecimals), snapshot, lines };
  }

  private async loadBalances(walletId: string): Promise<Balance[]> {
    const accounts = await this.db
      .selectFrom('accounts')
      .select(['currency', 'balance'])
      .where('wallet_id', '=', walletId)
      .execute();
    const byCurrency = new Map(accounts.map((a) => [a.currency, a.balance]));
    return CURRENCY_CODES.map((currency) => ({
      currency,
      amount: byCurrency.get(currency) ?? '0.000000',
    }));
  }
}
