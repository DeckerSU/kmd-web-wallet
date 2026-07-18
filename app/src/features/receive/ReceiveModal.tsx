import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button, Modal } from '../../components/ui';

export default function ReceiveModal(props: {
  ticker: string;
  address: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(props.address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Modal title={`Receive ${props.ticker}`} onClose={props.onClose}>
      <div className="flex flex-col items-center gap-4">
        <div className="rounded-xl bg-white p-3">
          <QRCodeSVG value={props.address} size={192} marginSize={0} />
        </div>
        <p className="max-w-full break-all text-center font-mono text-sm text-zinc-300">
          {props.address}
        </p>
        <p className="text-center text-xs text-zinc-500">
          Send only {props.ticker} to this address.
        </p>
        <Button className="w-full" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy address'}
        </Button>
      </div>
    </Modal>
  );
}
