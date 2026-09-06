export const MAX_STEPS = 2000;
export type Settings = {
  n: number;
  seed: number;
  initial: "left" | "balanced";
};
export type Event = {
  particle: number;
  flip: boolean;
  rngAfter: number;
  leftAfter: number;
};
export type Point = {
  step: number;
  left: number;
  right: number;
  entropy: number;
};
export const DEFAULT: Settings = { n: 100, seed: 42, initial: "left" };
export function validate(value: unknown): value is Settings {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const s = value as Record<string, unknown>;
  return (
    Object.keys(s).sort().join(",") === "initial,n,seed" &&
    Number.isInteger(s.n) &&
    Number(s.n) >= 20 &&
    Number(s.n) <= 300 &&
    Number.isInteger(s.seed) &&
    Number(s.seed) >= 0 &&
    Number(s.seed) <= 0xffffffff &&
    (s.initial === "left" || s.initial === "balanced")
  );
}
export function entropyTable(n: number): number[] {
  if (!Number.isInteger(n) || n < 20 || n > 300)
    throw new TypeError("Invalid particle count");
  const factorial = [0];
  for (let i = 1; i <= n; i++) factorial.push(factorial[i - 1] + Math.log2(i));
  return Array.from(
    { length: n + 1 },
    (_, k) => factorial[n] - factorial[k] - factorial[n - k],
  );
}
export function binomial(n: number): number[] {
  const values = entropyTable(n).map((s) => 2 ** (s - n));
  const total = values.reduce((a, b) => a + b, 0);
  return values.map((p) => p / total);
}
export function transition(n: number, k: number) {
  if (
    !Number.isInteger(n) ||
    n < 20 ||
    n > 300 ||
    !Number.isInteger(k) ||
    k < 0 ||
    k > n
  )
    throw new TypeError("Invalid state");
  return { down: k / (2 * n), stay: 0.5, up: (n - k) / (2 * n) };
}
function random(state: number): { state: number; value: number } {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { state, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}
export class Experiment {
  readonly settings: Settings;
  readonly entropies: number[];
  readonly theory: number[];
  private particles: Uint8Array;
  private history: Event[] = [];
  private pointer = 0;
  private leftCount: number;
  private rng: number;
  constructor(settings: Settings) {
    if (!validate(settings)) throw new TypeError("Invalid initial settings");
    this.settings = { ...settings };
    this.entropies = entropyTable(settings.n);
    this.theory = binomial(settings.n);
    this.leftCount =
      settings.initial === "left" ? settings.n : Math.floor(settings.n / 2);
    this.particles = new Uint8Array(settings.n);
    this.particles.fill(1, 0, this.leftCount);
    this.rng = settings.seed;
  }
  get step() {
    return this.pointer;
  }
  get recorded() {
    return this.history.length;
  }
  get left() {
    return this.leftCount;
  }
  get entropy() {
    return this.entropies[this.leftCount];
  }
  get canForward() {
    return this.pointer < MAX_STEPS;
  }
  get canBack() {
    return this.pointer > 0;
  }
  get state() {
    return {
      particles: Array.from(this.particles),
      left: this.leftCount,
      rng: this.rng,
      step: this.pointer,
    };
  }
  get event(): Event | null {
    return this.pointer ? { ...this.history[this.pointer - 1] } : null;
  }
  forward(): boolean {
    if (!this.canForward) return false;
    let event = this.history[this.pointer];
    if (!event) {
      const choice = random(this.rng);
      const coin = random(choice.state);
      const particle = Math.floor(choice.value * this.settings.n);
      const flip = coin.value < 0.5;
      event = {
        particle,
        flip,
        rngAfter: coin.state,
        leftAfter:
          this.leftCount + (flip ? (this.particles[particle] ? -1 : 1) : 0),
      };
      this.history.push(event);
    }
    if (event.flip) this.particles[event.particle] ^= 1;
    this.leftCount = event.leftAfter;
    this.rng = event.rngAfter;
    this.pointer++;
    return true;
  }
  back(): boolean {
    if (!this.canBack) return false;
    const event = this.history[this.pointer - 1];
    if (event.flip) this.particles[event.particle] ^= 1;
    this.pointer--;
    this.leftCount = this.pointer
      ? this.history[this.pointer - 1].leftAfter
      : this.settings.initial === "left"
        ? this.settings.n
        : Math.floor(this.settings.n / 2);
    this.rng = this.pointer
      ? this.history[this.pointer - 1].rngAfter
      : this.settings.seed;
    return true;
  }
  seek(step: number): void {
    if (!Number.isInteger(step) || step < 0 || step > this.history.length)
      throw new TypeError("Can only seek recorded steps");
    while (this.pointer > step) this.back();
    while (this.pointer < step) this.forward();
  }
  points(): Point[] {
    const start =
      this.settings.initial === "left"
        ? this.settings.n
        : Math.floor(this.settings.n / 2);
    const counts = [
      start,
      ...this.history.slice(0, this.pointer).map((e) => e.leftAfter),
    ];
    return counts.map((left, step) => ({
      step,
      left,
      right: this.settings.n - left,
      entropy: this.entropies[left],
    }));
  }
  histogram(): number[] {
    const counts = Array(this.settings.n + 1).fill(0);
    for (const p of this.points()) counts[p.left]++;
    return counts;
  }
}
export function encode(settings: Settings): string {
  if (!validate(settings)) throw new TypeError("Invalid settings");
  return `#v1.${settings.n}.${settings.seed}.${settings.initial}`;
}
export function decode(hash: string): Settings | null {
  if (typeof hash !== "string" || hash.length > 60) return null;
  const match =
    /^#v1\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,9})\.(left|balanced)$/.exec(
      hash,
    );
  if (!match) return null;
  const candidate = {
    n: Number(match[1]),
    seed: Number(match[2]),
    initial: match[3],
  };
  return validate(candidate) ? candidate : null;
}
export function toCSV(experiment: Experiment): string {
  return (
    "step,n_left,n_right,macro_entropy_bits\r\n" +
    experiment
      .points()
      .map((p) => [p.step, p.left, p.right, p.entropy].join(","))
      .join("\r\n") +
    "\r\n"
  );
}
