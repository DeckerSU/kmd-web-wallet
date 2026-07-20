import arrrIcon from '../../assets/coins/arrr.png';
import kmdIcon from '../../assets/coins/kmd.png';
import kmdclIcon from '../../assets/coins/kmdcl.png';

/** Icon and display name per ticker, shared by the portfolio screens. */
export const COIN_ICONS: Record<string, string> = {
  KMD: kmdIcon,
  KMDCL: kmdclIcon,
  ARRR: arrrIcon,
};

export const COIN_LABELS: Record<string, string> = {
  KMD: 'Komodo',
  KMDCL: 'KomodoClassic',
  ARRR: 'Pirate',
};
