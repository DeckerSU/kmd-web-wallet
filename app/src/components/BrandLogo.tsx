import logoUrl from '../assets/logo.png';

/**
 * The app's brand mark: a Komodo-dragon shield with a keyhole, tinted with the
 * emerald→teal brand gradient. It has transparent interior detail, so it is
 * meant to sit on the app's dark background.
 */
export function BrandLogo(props: { size?: number; glow?: boolean; className?: string }) {
  const size = props.size ?? 40;
  return (
    <img
      src={logoUrl}
      alt="KMD Wallet"
      width={size}
      height={size}
      className={`object-contain ${
        props.glow ? 'drop-shadow-[0_6px_20px_rgba(16,185,129,0.28)]' : ''
      } ${props.className ?? ''}`}
    />
  );
}
