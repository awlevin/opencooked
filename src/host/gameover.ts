// Results screen: final score, served / missed tallies, star rating.

const SVG_NS = 'http://www.w3.org/2000/svg';

const STAR_PATH = (() => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 44 : 19;
    pts.push(`${(50 + Math.cos(a) * r).toFixed(2)},${(52 + Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
})();

const VERDICTS = [
  'Rough shift. Regroup, chefs.',
  'The kitchen survived.',
  'Solid service!',
  'Michelin material!',
] as const;

export function starsFor(score: number): number {
  if (score >= 200) return 3;
  if (score >= 120) return 2;
  if (score >= 60) return 1;
  return 0;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

export class GameOverScreen {
  private readonly starsEl = el<HTMLDivElement>('stars');
  private readonly scoreEl = el<HTMLDivElement>('finalScore');
  private readonly servedEl = el<HTMLSpanElement>('finalServed');
  private readonly missedEl = el<HTMLSpanElement>('finalMissed');
  private readonly verdictEl = el<HTMLDivElement>('verdict');

  show(score: number, served: number, missed: number): void {
    this.scoreEl.textContent = String(score);
    this.servedEl.textContent = String(served);
    this.missedEl.textContent = String(missed);

    const stars = starsFor(score);
    this.verdictEl.textContent = VERDICTS[stars] ?? VERDICTS[0];

    // Rebuild so the pop-in animation replays every time.
    this.starsEl.textContent = '';
    for (let i = 0; i < 3; i++) {
      const svg = document.createElementNS(SVG_NS, 'svg');
      // Roomy viewBox so the gold star's glow is not clipped by the SVG box.
      svg.setAttribute('viewBox', '-26 -26 152 152');
      if (i < stars) svg.classList.add('on');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', STAR_PATH);
      path.setAttribute('class', 'fill');
      svg.append(path);
      this.starsEl.append(svg);
    }
  }
}
