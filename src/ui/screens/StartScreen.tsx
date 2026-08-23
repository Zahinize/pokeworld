import { OceanBackdrop } from '../components/common';
import { Audio } from '@/audio/AudioManager';

export function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <>
      <OceanBackdrop />
      <div className="screen">
        <div className="screen-inner center start-screen">
          <div className="logo start-logo"><span className="logo-text">PokeWorld</span></div>
          <p className="start-tagline">Where Pokémon live wild.</p>
          <button className="btn start-btn" onClick={() => { Audio.init(); Audio.uiConfirm(); onStart(); }} autoFocus>
            <span>Game Start</span>
          </button>
        </div>
      </div>
    </>
  );
}
