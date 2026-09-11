import arrrIcon from '../../assets/coins/arrr.png';
import gleecIcon from '../../assets/coins/gleec.png';
import kmdIcon from '../../assets/coins/kmd.png';
import kmdclIcon from '../../assets/coins/kmdcl.png';
import tonIcon from '../../assets/coins/ton.svg';

/** Icon and display name per ticker, shared by the portfolio screens. */
export const COIN_ICONS: Record<string, string> = {
  KMD: kmdIcon,
  KMDCL: kmdclIcon,
  ARRR: arrrIcon,
  GLEEC: gleecIcon,
  GRAM: tonIcon,
};

export const COIN_LABELS: Record<string, string> = {
  KMD: 'Komodo',
  KMDCL: 'KomodoClassic',
  ARRR: 'Pirate',
  GLEEC: 'Gleec',
  GRAM: 'GRAM (TON)',
};
