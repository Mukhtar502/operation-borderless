import type { DB } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { CURRENCY_CODES, type CurrencyCode } from '../../domain/currencies.js';
import { normalizeEmail, normalizePhone } from '../../domain/identifiers.js';
import { conflict, notFound } from '../../lib/errors.js';

export interface Balance {
  currency: CurrencyCode;
  amount: string;
}

export interface WalletView {
  id: string;
  email: string | null;
  phone: string | null;
  balances: Balance[];
  createdAt: Date;
}

export interface CreateWalletInput {
  email?: string | undefined;
  phone?: string | undefined;
}

export class WalletService {
  constructor(private readonly db: DB) {}

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

    const accounts = await this.db
      .selectFrom('accounts')
      .select(['currency', 'balance'])
      .where('wallet_id', '=', walletId)
      .execute();
    const byCurrency = new Map(accounts.map((a) => [a.currency, a.balance]));

    return {
      id: wallet.id,
      email: wallet.email,
      phone: wallet.phone,
      balances: CURRENCY_CODES.map((currency) => ({
        currency,
        amount: byCurrency.get(currency) ?? '0.000000',
      })),
      createdAt: wallet.created_at,
    };
  }
}
