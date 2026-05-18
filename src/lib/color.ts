/**
 * Blend two `#rrggbb` hex colors at the given mix ratio.
 *
 * `mix=0` returns pure `a`, `mix=1` returns pure `b`, `mix=0.5` is the
 * midpoint. Used both by the renderer (e.g. mid-tone room separators
 * sitting between `muted` and `mutedForeground`) and by `vibeColor`
 * (`sleepy` is a washed-out blue derived from `info`).
 */
export const blendHex = (a: string, b: string, mix: number): string => {
  const parse = (hex: string): [number, number, number] => {
    const h = hex.replace("#", "");
    if (h.length !== 6) return [0, 0, 0];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const t = Math.max(0, Math.min(1, mix));
  const lerp = (x: number, y: number): number => Math.round(x + (y - x) * t);
  const toHex = (n: number): string => n.toString(16).padStart(2, "0");
  return `#${toHex(lerp(ar, br))}${toHex(lerp(ag, bg))}${toHex(lerp(ab, bb))}`;
};
