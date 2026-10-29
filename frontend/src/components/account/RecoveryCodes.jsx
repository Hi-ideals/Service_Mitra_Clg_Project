import { useState } from 'react';
import { Copy, Check, Printer } from 'lucide-react';
import { useToast } from '../../context/ToastContext.jsx';
import Alert from '../ui/Alert.jsx';
import Button from '../ui/Button.jsx';
import Modal from '../ui/Modal.jsx';

/**
 * The ten codes that are the way back in, shown exactly once.
 *
 * Only their hashes are kept, so nothing can display them again - which is why
 * this dialog does not close on a backdrop click and why the button says what
 * it says. Everything here is built around the person actually writing them
 * down before they move on.
 */
export default function RecoveryCodes({ codes, onClose, intro }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy. Write them down instead.');
    }
  }

  return (
    <Modal open onClose={() => {}} title="Save your recovery codes" size="md">
      <Alert variant="warning" title="This is the only time you will see these">
        {intro ?? (
          <>
            Each code signs you in once if you lose your phone. Print them or write them down and
            keep them somewhere safe - not on the phone itself.
          </>
        )}
      </Alert>

      <ul className="mt-4 grid grid-cols-2 gap-2">
        {codes.map((code) => (
          <li
            key={code}
            className="rounded-field bg-ink-50 px-3 py-2 text-center font-mono text-sm tracking-wider text-ink-900"
          >
            {code}
          </li>
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="secondary" icon={copied ? Check : Copy} onClick={copy}>
          {copied ? 'Copied' : 'Copy all'}
        </Button>
        <Button variant="secondary" icon={Printer} onClick={() => window.print()}>
          Print
        </Button>
        <Button className="ml-auto" onClick={onClose}>
          I have saved them
        </Button>
      </div>
    </Modal>
  );
}
