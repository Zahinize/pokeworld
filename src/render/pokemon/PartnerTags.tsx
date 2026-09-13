/**
 * Small floating trainer tag (avatar + name) beneath each active companion, so your team
 * stands out from the wild reef at a glance. Two Html elements max — negligible cost.
 */
import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { session } from '@/engine/GameSession';
import { useStore } from '@/state/store';
import { getTrainer } from '@/data/trainers';

function Tag({ slot }: { slot: 0 | 1 }) {
  const group = useRef<THREE.Group>(null);
  const trainer = getTrainer(useStore((s) => s.save.trainer?.id));
  const visible = useRef(false);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const eco = session.eco;
    const e = eco?.byId.get(session.activePartners[slot]);
    const show = !!e && e.state !== 'ko' && e.state !== 'removed' && e.state !== 'caught';
    if (show !== visible.current) { visible.current = show; g.visible = show; }
    if (e && show) g.position.set(e.x, e.y - e.species.size * 0.5 - 0.4, e.z);
  });
  if (!trainer) return null;
  return (
    <group ref={group} visible={false}>
      <Html center distanceFactor={6.5} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div className="partner-tag">
          <span className="pt-avatar"><img src={trainer.image} alt="" draggable={false} style={{ height: 20 * trainer.face.scale, left: 20 * trainer.face.x, top: 20 * trainer.face.y }} /></span>
          <span className="pt-name">{trainer.name.split(' ')[0]}</span>
        </div>
      </Html>
    </group>
  );
}

export function PartnerTags() {
  const enabled = useStore((s) => s.mission !== null);
  if (!enabled || !session.companionsEnabled) return null;
  return (<><Tag slot={0} /><Tag slot={1} /></>);
}
