import type { TrainerConfig } from './types';

export const TRAINERS: TrainerConfig[] = [
  { id: 'ash', name: 'Ash Ketchum', tagline: 'Pallet Town · never gives up', accent: '#f43f5e', avatar: '🧢' },
  { id: 'misty', name: 'Misty', tagline: 'Cerulean City · water specialist', accent: '#f59e0b', avatar: '🌊' },
];

export function getTrainer(id: string | null | undefined): TrainerConfig | undefined {
  return TRAINERS.find((t) => t.id === id);
}
