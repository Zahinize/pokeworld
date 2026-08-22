import { OceanBackdrop } from '../components/common';

export function LoadingScreen({ progress, label }: { progress: number; label: string }) {
  return (
    <>
      <OceanBackdrop />
      <div className="screen">
        <div className="screen-inner center" style={{ maxWidth: 420 }}>
          <div className="logo">PokeWorld<small>Sea Reef</small></div>
          <div className="progress" style={{ margin: '28px auto 10px', maxWidth: 320 }}><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <div className="muted small">{label}</div>
        </div>
      </div>
    </>
  );
}
