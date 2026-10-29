import { useState } from 'react';
import { Landmark, Smartphone, Copy, Check, AlertTriangle } from 'lucide-react';

/** Copies one value and says so, because a silent copy is indistinguishable from a broken one. */
function CopyField({ label, value, mono = false }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused; the value is on screen to read either way.
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className="min-w-0">
        <span className="block text-xs text-ink-500">{label}</span>
        <span className={'block break-all text-sm text-ink-900' + (mono ? ' font-mono tabular-nums' : '')}>
          {value}
        </span>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={'Copy ' + label.toLowerCase()}
        className="shrink-0 rounded-field p-1.5 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-700"
      >
        {copied ? (
          <Check aria-hidden="true" className="h-4 w-4 text-success-600" />
        ) : (
          <Copy aria-hidden="true" className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

/**
 * Where to send one provider's money.
 *
 * Every value is copyable because the admin is retyping these into a banking
 * app, and a mistyped account number is money that does not come back.
 */
export default function PayoutDestination({ destination }) {
  if (!destination) {
    return (
      <p className="mt-2 flex items-start gap-1.5 text-sm text-warning-700">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        No UPI id or bank account on file. Ask the provider to add one before paying.
      </p>
    );
  }

  const Icon = destination.method === 'upi' ? Smartphone : Landmark;

  return (
    <div className="mt-2 panel-tint rounded-field px-3 py-2">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-500">
        <Icon aria-hidden="true" className="h-3.5 w-3.5" />
        {destination.method === 'upi' ? 'UPI' : 'Bank transfer'}
      </p>

      <div className="mt-1 divide-y divide-ink-200/70">
        {destination.method === 'upi' ? (
          <CopyField label="UPI id" value={destination.upiId} mono />
        ) : (
          <>
            <CopyField label="Name on account" value={destination.accountName} />
            <CopyField label="Account number" value={destination.accountNumber} mono />
            <CopyField label="IFSC" value={destination.ifsc} mono />
            {destination.bankName && <CopyField label="Bank" value={destination.bankName} />}
          </>
        )}
      </div>
    </div>
  );
}
