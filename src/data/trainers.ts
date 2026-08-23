import type { TrainerConfig } from './types';

export const TRAINERS: TrainerConfig[] = [
  { id: 'ash', name: 'Ash Ketchum', tagline: 'Pallet Town · never gives up', accent: '#f43f5e', avatar: '🧢',
    image: '/sprites/trainers/ash.png', face: { scale: 3.15, x: -0.256, y: 0.09 } },
  { id: 'misty', name: 'Misty', tagline: 'Cerulean City · water specialist', accent: '#f59e0b', avatar: '🌊',
    image: '/sprites/trainers/misty.png', face: { scale: 3.17, x: -0.167, y: 0.056 } },
];

export function getTrainer(id: string | null | undefined): TrainerConfig | undefined {
  return TRAINERS.find((t) => t.id === id);
}
