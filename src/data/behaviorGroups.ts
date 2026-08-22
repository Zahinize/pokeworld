import type { BehaviorGroup } from './types';

export interface BehaviorGroupMeta {
  id: BehaviorGroup;
  label: string;
  plural: string;
  icon: string;
  description: string;
}

export const BEHAVIOR_GROUPS: Record<BehaviorGroup, BehaviorGroupMeta> = {
  schooling: { id: 'schooling', label: 'Schooling Fish', plural: 'Schooling Fish', icon: '🐟', description: 'Swim in tight, shifting schools. Scatter from danger and regroup around their guardian.' },
  passive: { id: 'passive', label: 'Passive Drifter', plural: 'Passive Drifters', icon: '🌊', description: 'Slow, peaceful swimmers that drift with the current in loose groups.' },
  curious: { id: 'curious', label: 'Curious Explorer', plural: 'Curious Explorers', icon: '🔎', description: 'Roam widely and will come over to inspect a visiting trainer.' },
  predator: { id: 'predator', label: 'Territorial Predator', plural: 'Territorial Predators', icon: '🦈', description: 'Patrol a territory and occasionally hunt. Schools scatter when they approach.' },
  bottom: { id: 'bottom', label: 'Bottom Dweller', plural: 'Bottom Dwellers', icon: '🪨', description: 'Rest among the rocks and sand of the reef floor.' },
  defensive: { id: 'defensive', label: 'Defensive Fish', plural: 'Defensive Fish', icon: '🫧', description: 'Peaceful, but flee fast and hard when threatened.' },
  giant: { id: 'giant', label: 'Gentle Giant', plural: 'Gentle Giants', icon: '🐋', description: 'Huge, slow travellers of the open water.' },
};
