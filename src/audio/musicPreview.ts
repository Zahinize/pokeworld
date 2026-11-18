/** Dev-only listening page for the boss themes: /dev/music-preview.html on the Vite dev server. */
import { BossMusicPlayer, type BossTheme } from './BossMusic';
import { BOSS_THEMES } from './bossThemes';

const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
const master = ctx.createGain(); master.gain.value = 0.7; master.connect(ctx.destination);
const player = new BossMusicPlayer(ctx, master);
// expose for scripted checks
(window as unknown as { __music: { ctx: AudioContext; player: BossMusicPlayer; themes: BossTheme[] } }).__music = { ctx, player, themes: BOSS_THEMES };

const cards = document.getElementById('cards')!;
const status = document.getElementById('status')!;
const cardEls = new Map<string, { card: HTMLElement; bars: HTMLElement[]; head: HTMLElement; play: HTMLButtonElement }>();

for (const t of BOSS_THEMES) {
  const card = document.createElement('section'); card.className = 'card'; card.dataset.id = t.id;
  const play = document.createElement('button'); play.className = 'play'; play.textContent = '▶'; play.setAttribute('aria-label', `Play ${t.name}`);
  const body = document.createElement('div');
  body.innerHTML = `<h2 class="name">${t.name} <span class="meta">${t.key} · ${t.bpm} BPM · ${t.bars} bars</span></h2><p class="tag">${t.tagline}</p><p class="insp"><b>In the style of:</b> ${t.inspiration}</p>`;
  const meter = document.createElement('div'); meter.className = 'meter';
  const bars: HTMLElement[] = [];
  for (let i = 0; i < 48; i++) { const b = document.createElement('i'); meter.appendChild(b); bars.push(b); }
  const bar = document.createElement('div'); bar.className = 'bar'; const head = document.createElement('i'); bar.appendChild(head);
  card.append(play, body, meter, bar);
  cards.appendChild(card);
  cardEls.set(t.id, { card, bars, head, play });
  play.addEventListener('click', () => { if (player.playing?.id === t.id) stop(); else start(t); });
}

function start(t: BossTheme) {
  void ctx.resume();
  player.play(t);
  for (const [id, el] of cardEls) { el.card.classList.toggle('on', id === t.id); el.play.textContent = id === t.id ? '■' : '▶'; }
  status.textContent = `Playing ${t.name}`;
}
function stop() {
  player.stop(0.6);
  for (const el of cardEls.values()) { el.card.classList.remove('on'); el.play.textContent = '▶'; el.head.style.width = '0'; for (const b of el.bars) b.style.height = '2px'; }
  status.textContent = '';
}

document.getElementById('stop')!.addEventListener('click', stop);
(document.getElementById('vol') as HTMLInputElement).addEventListener('input', (e) => { master.gain.setTargetAtTime(Number((e.target as HTMLInputElement).value), ctx.currentTime, 0.05); });

const freq = new Uint8Array(256);
function animate() {
  const t = player.playing;
  if (t && player.analyser) {
    const el = cardEls.get(t.id)!;
    player.analyser.getByteFrequencyData(freq);
    for (let i = 0; i < el.bars.length; i++) { const v = freq[Math.floor(i * 1.6) + 1] / 255; el.bars[i].style.height = `${2 + v * 32}px`; }
    el.head.style.width = `${(player.beat / (t.bars * 4)) * 100}%`;
  }
  requestAnimationFrame(animate);
}
animate();
