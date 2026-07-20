import { useState } from 'react';
import { Alert, Button, Modal, Spinner, TextField } from '../../components/ui';
import { coinByTicker } from '../../config/coins';
import {
  sendRawTransaction,
  taskWithdrawInit,
  taskWithdrawStatus,
  validateAddress,
  withdraw,
  type TransactionDetails,
  type WithdrawAmount,
} from '../../kdf/methods';
import { formatAmount } from '../../lib/format';
import { usePortfolioStore } from '../../store/portfolio';

type Step =
  | { name: 'form' }
  | { name: 'confirm'; tx: TransactionDetails; isMax: boolean }
  | { name: 'sent'; txid: string };

const WITHDRAW_POLL_MS = 700;
const WITHDRAW_TIMEOUT_MS = 5 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Build a signed withdrawal. ZHTLC coins (ARRR) reject the direct `withdraw`
 * and must go through task::withdraw::init → status; memo is shielded-only.
 */
async function buildWithdrawal(
  ticker: string,
  isZhtlc: boolean,
  to: string,
  amount: WithdrawAmount,
  memo?: string,
): Promise<TransactionDetails> {
  if (!isZhtlc) return withdraw(ticker, to, amount);

  const taskId = await taskWithdrawInit(ticker, to, amount, memo);
  const deadline = Date.now() + WITHDRAW_TIMEOUT_MS;
  for (;;) {
    const res = await taskWithdrawStatus(taskId);
    if (res.status === 'Ok') return res.details;
    if (res.status === 'Error') throw new Error(res.details.error);
    if (Date.now() > deadline) throw new Error('Withdrawal timed out');
    await sleep(WITHDRAW_POLL_MS);
  }
}

export default function SendModal(props: {
  ticker: string;
  spendable: string;
  onClose: () => void;
}) {
  const { ticker, spendable } = props;
  const refreshBalances = usePortfolioStore((s) => s.refreshBalances);
  const isZhtlc = coinByTicker(ticker)?.kind === 'zhtlc';

  const [step, setStep] = useState<Step>({ name: 'form' });
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [isMax, setIsMax] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = async () => {
    setBusy(true);
    setError(null);
    try {
      const addr = to.trim();
      const validation = await validateAddress(ticker, addr);
      if (!validation.is_valid) {
        throw new Error(validation.reason ?? 'Invalid address');
      }
      const tx = await buildWithdrawal(
        ticker,
        isZhtlc,
        addr,
        isMax ? { max: true } : { amount: amount.trim() },
        isZhtlc && memo.trim() ? memo.trim() : undefined,
      );
      setStep({ name: 'confirm', tx, isMax });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const broadcast = async (tx: TransactionDetails) => {
    setBusy(true);
    setError(null);
    try {
      const txid = await sendRawTransaction(ticker, tx.tx_hex);
      setStep({ name: 'sent', txid });
      void refreshBalances();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const amountValid = isMax || /^\d+(\.\d{1,8})?$/.test(amount.trim());
  const explorerTxUrl = coinByTicker(ticker)?.explorerTxUrl;

  return (
    <Modal title={`Send ${ticker}`} onClose={props.onClose}>
      {step.name === 'form' && (
        <div className="space-y-4">
          <TextField
            label="Recipient address"
            value={to}
            onChange={setTo}
            placeholder={isZhtlc ? 'zs…' : 'R…'}
            autoFocus
          />
          <div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <TextField
                  label="Amount"
                  value={isMax ? spendable : amount}
                  onChange={(v) => {
                    setIsMax(false);
                    setAmount(v);
                  }}
                  placeholder="0.0"
                />
              </div>
              <Button
                variant={isMax ? 'primary' : 'ghost'}
                onClick={() => setIsMax(!isMax)}
                className="mb-[1px]"
              >
                Max
              </Button>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Available: {formatAmount(spendable)} {ticker}
            </p>
          </div>
          {isZhtlc && (
            <TextField
              label="Memo (optional)"
              value={memo}
              onChange={setMemo}
              placeholder="Shielded memo"
            />
          )}
          {error && <Alert kind="error">{error}</Alert>}
          {busy ? (
            <Spinner label={isZhtlc ? 'Building transaction (may take a while)…' : 'Building transaction…'} />
          ) : (
            <Button
              className="w-full"
              disabled={!to.trim() || !amountValid}
              onClick={() => void preview()}
            >
              Preview
            </Button>
          )}
        </div>
      )}

      {step.name === 'confirm' && (
        <div className="space-y-4">
          <SummaryRow label="To" value={step.tx.to.filter((a) => a !== step.tx.from[0]).join(', ') || step.tx.to.join(', ')} mono />
          <SummaryRow
            label="Amount"
            value={`${formatAmount(
              step.isMax
                ? (Number(step.tx.spent_by_me) - Number(step.tx.fee_details.amount)).toFixed(8)
                : amount.trim(),
            )} ${ticker}`}
          />
          <SummaryRow
            label="Network fee"
            value={`${formatAmount(step.tx.fee_details.amount)} ${ticker}`}
          />
          <SummaryRow
            label="Balance change"
            value={`${formatAmount(step.tx.my_balance_change)} ${ticker}`}
          />
          {step.tx.kmd_rewards && Number(step.tx.kmd_rewards.amount) > 0 && (
            <Alert kind="info">
              Claims {formatAmount(step.tx.kmd_rewards.amount)} KMD in accrued rewards.
            </Alert>
          )}
          {error && <Alert kind="error">{error}</Alert>}
          {busy ? (
            <Spinner label="Broadcasting…" />
          ) : (
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setStep({ name: 'form' })}>
                Back
              </Button>
              <Button className="flex-1" onClick={() => void broadcast(step.tx)}>
                Confirm &amp; send
              </Button>
            </div>
          )}
        </div>
      )}

      {step.name === 'sent' && (
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-2xl text-emerald-400">
            ✓
          </div>
          <p className="text-sm text-zinc-300">Transaction broadcast</p>
          <p className="break-all font-mono text-xs text-zinc-500">{step.txid}</p>
          {explorerTxUrl && (
            <a
              href={explorerTxUrl(step.txid)}
              target="_blank"
              rel="noreferrer"
              className="block text-sm text-emerald-400 transition hover:text-emerald-300"
            >
              View in explorer ↗
            </a>
          )}
          <Button className="w-full" onClick={props.onClose}>
            Done
          </Button>
        </div>
      )}
    </Modal>
  );
}

function SummaryRow(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-sm text-zinc-500">{props.label}</span>
      <span
        className={`break-all text-right text-sm text-zinc-200 ${props.mono ? 'font-mono text-xs leading-5' : ''}`}
      >
        {props.value}
      </span>
    </div>
  );
}
