import type { Options } from 'canvas-confetti';

/**
 * M446: Konfetti (canvas-confetti) erst beim ersten Wurf laden — es gehört nicht in den Start.
 * Der Wurf kommt dadurch beim allerersten Mal ein paar Millisekunden später; danach liegt der Teil bereit.
 */
export function konfettiWerfen(opts: Options): void {
  void import('canvas-confetti').then((m) => m.default(opts)).catch(() => {});
}
