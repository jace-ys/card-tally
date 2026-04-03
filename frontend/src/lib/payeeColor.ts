import type { CSSProperties } from "react";

function parseHexRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const raw = m[1];
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return [r, g, b];
}

function fallbackRgb(payeeId: number): [number, number, number] {
  const hue = (payeeId * 59) % 360;
  const saturation = 72;
  const lightness = 56;
  const c = (1 - Math.abs((2 * lightness) / 100 - 1)) * (saturation / 100);
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness / 100 - c / 2;
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

export function payeeColorStyle(payeeId: number, preferredColor?: string | null): CSSProperties {
  const rgb = parseHexRgb(preferredColor ?? "") ?? fallbackRgb(payeeId);
  const [r, g, b] = rgb;
  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.16)`,
    borderColor: `rgba(${r}, ${g}, ${b}, 0.5)`,
    color: `rgb(${Math.round(r * 0.52)}, ${Math.round(g * 0.45)}, ${Math.round(b * 0.42)})`,
  };
}
