import type { TrainerConfig } from './types';

export const TRAINERS: TrainerConfig[] = [
  { id: 'ash', name: 'Ash Ketchum', tagline: 'Pallet Town · never gives up', accent: '#f43f5e', avatar: '🧢',
    image: 'https://archives.bulbagarden.net/media/upload/thumb/c/cd/Ash_JN.png/400px-Ash_JN.png', face: { scale: 3.15, x: -0.256, y: 0.09 } },
  { id: 'misty', name: 'Misty', tagline: 'Cerulean City · water specialist', accent: '#f59e0b', avatar: '🌊',
    image: 'https://archives.bulbagarden.net/media/upload/9/96/Misty_JN.png', face: { scale: 3.17, x: -0.167, y: 0.056 } },
];

export function getTrainer(id: string | null | undefined): TrainerConfig | undefined {
  return TRAINERS.find((t) => t.id === id);
}
