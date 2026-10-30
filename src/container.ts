import type { DB } from './db/client.js';
import { DepositService } from './modules/deposits/deposit.service.js';
import { IdempotencyService } from './modules/idempotency/idempotency.service.js';
import { LedgerService } from './modules/ledger/ledger.service.js';
import type { FxService } from './modules/rates/fx.service.js';
import { SwapService } from './modules/swaps/swap.service.js';
import { TransactionService } from './modules/transactions/transaction.service.js';
import { TransferService } from './modules/transfers/transfer.service.js';
import { WalletService } from './modules/wallets/wallet.service.js';

export type Services = ReturnType<typeof createServices>;

/**
 * The one place services are built and wired together. Everything receives its
 * dependencies here, so tests can swap any of them (e.g. a fake FX provider).
 */
export function createServices({ db, fx }: { db: DB; fx: FxService }) {
  const ledger = new LedgerService();
  const idempotency = new IdempotencyService(db);

  return {
    fx,
    wallets: new WalletService(db, fx),
    deposits: new DepositService(ledger, idempotency),
    swaps: new SwapService(ledger, idempotency, fx),
    transfers: new TransferService(ledger, idempotency, fx),
    transactions: new TransactionService(db),
  };
}
