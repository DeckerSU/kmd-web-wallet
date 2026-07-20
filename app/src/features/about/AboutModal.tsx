import { BrandLogo } from '../../components/BrandLogo';
import { Modal } from '../../components/ui';

/**
 * Contributors to komodo-defi-framework, ordered by commit count (descending),
 * obvious author aliases merged. Snapshot taken 2026-07-18 via `git shortlog`.
 */
const KDF_CONTRIBUTORS = [
  'jl777',
  'Artem Pikulin',
  'Artem Grinblat',
  'shamardy',
  'Onur Özkan',
  'Sergey Boyko',
  'Roman Sztergbaum',
  'Samuel Onoja',
  'Dmitrii Rozhkov',
  'DeckerSU',
  'Kadan Stadelmann (ca333)',
  'Alina Sharon',
  'Omer Yacine',
  'dimxy',
  'vineetbhargav86',
  'Mayur Nagekar',
  'usamir',
  'fadedreamz',
  'Shailesh',
  'Mihail Fedorov',
  'Satinder Grewal',
  'Caglar Kaya',
  'flamingice',
  'Anton "TonyL" Lysakov',
  'oxarbitrage',
  'smk762',
  'Luke Childs',
  'Alright',
  'Christopher Valerio',
  'ptyx11',
  'SHossain',
  'St3rling0x',
  'siulynot',
  'Ahmed Mohamed Ibrahim',
  'rohvsh',
  'mirrt',
  'uak',
  'cipig',
  'gcharang',
  'John Nash',
  'Jorian',
  'kashifali',
  'pbca26',
  'pnosker',
  'VanBreuk',
  'abdul294',
  'amarvashi12',
  'Bastien Penavayre',
  'Cedomir Djosic',
  'Charl (Nitride)',
  'Craig Donnachie',
  'Etienne Theodore',
  'hatef',
  'James Michael DuPont',
  'levoncrypto',
  'lightspeed393',
  'patchkez',
  'Paul Romero',
  'pondsea',
  'tpoonach',
  'webworker01',
];

export default function AboutModal(props: { onClose: () => void }) {
  return (
    <Modal title="About" onClose={props.onClose}>
      <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1 text-sm leading-relaxed text-zinc-300">
        <div className="flex items-center gap-3">
          <BrandLogo size={48} className="shrink-0" />
          <div>
            <p className="font-semibold text-zinc-100">KMD Wallet</p>
            <p className="text-xs text-zinc-500">
              Decker&apos;s non-custodial Komodo wallet, powered by the Komodo DeFi
              Framework running as WebAssembly in your browser.
            </p>
          </div>
        </div>

        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Authors
          </h3>
          <p>
            <span className="text-zinc-100">DeckerSU</span> — author &amp; maintainer
            <br />
            <span className="text-zinc-100">Claude Fable 5</span> — Anthropic&apos;s AI
            coding agent, co-developer of this app
          </p>
        </div>

        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Acknowledgements
          </h3>
          <p>
            The author expresses huge gratitude to{' '}
            <span className="text-zinc-100">jl777</span> for creating Komodo (KMD) and
            for all those best years spent in the Komodo team; to{' '}
            <span className="text-zinc-100">ca333</span> — for all the good he has done
            for me personally; and to the whole Komodo team and everyone who has ever
            been part of it — working side by side with professionals has always been
            interesting, and has always been motivating.
          </p>
        </div>

        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Greetings
          </h3>
          <p className="mb-2">
            To everyone who has ever committed to{' '}
            <a
              href="https://github.com/KomodoPlatform/komodo-defi-framework"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-400 transition hover:text-emerald-300"
            >
              komodo-defi-framework
            </a>{' '}
            — you created a truly awesome, yet somehow underappreciated product:
          </p>
          <p className="text-xs text-zinc-400">{KDF_CONTRIBUTORS.join(' · ')}</p>
        </div>
      </div>
    </Modal>
  );
}
