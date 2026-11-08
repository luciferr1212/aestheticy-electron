export interface DominantPalette {
  primary: string;      // Rich background glow #1
  secondary: string;    // Rich background glow #2
  accent: string;       // Vibrant highlight accent
  accentSoft: string;   // Translucent tint for glass borders/active states
  primaryRgb: string;   // "r, g, b"
  secondaryRgb: string; // "r, g, b"
  accentRgb: string;    // "r, g, b"
}

const DEFAULT_PALETTE: DominantPalette = {
  primary: '#312E81',
  secondary: '#1E1B4B',
  accent: '#818CF8',
  accentSoft: 'rgba(129, 140, 248, 0.24)',
  primaryRgb: '49, 46, 129',
  secondaryRgb: '30, 27, 75',
  accentRgb: '129, 140, 248',
};

const paletteCache = new Map<string, DominantPalette>();

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360 / 360;
  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function toHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0'))
      .join('')
  );
}

function buildPaletteFromHue(hue: number, secHueOffset = 38): DominantPalette {
  const [pR, pG, pB] = hslToRgb(hue, 0.72, 0.34);
  const [sR, sG, sB] = hslToRgb(hue + secHueOffset, 0.68, 0.25);
  const [aR, aG, aB] = hslToRgb(hue, 0.88, 0.7);

  return {
    primary: toHex(pR, pG, pB),
    secondary: toHex(sR, sG, sB),
    accent: toHex(aR, aG, aB),
    accentSoft: `rgba(${aR}, ${aG}, ${aB}, 0.24)`,
    primaryRgb: `${pR}, ${pG}, ${pB}`,
    secondaryRgb: `${sR}, ${sG}, ${sB}`,
    accentRgb: `${aR}, ${aG}, ${aB}`,
  };
}

export function getSeedPalette(seedText: string): DominantPalette {
  let hash = 0;
  for (let i = 0; i < seedText.length; i++) {
    hash = seedText.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return buildPaletteFromHue(hue, 45);
}

/**
 * Extracts dominant vibrant colors from an album art URL using an offscreen 32x32 canvas.
 */
export async function extractPaletteFromCoverArt(
  coverArtUrl: string | null | undefined,
  fallbackSeed: string
): Promise<DominantPalette> {
  if (!coverArtUrl) {
    return fallbackSeed ? getSeedPalette(fallbackSeed) : DEFAULT_PALETTE;
  }

  const cacheKey = `${coverArtUrl}::${fallbackSeed}`;
  if (paletteCache.has(cacheKey)) {
    return paletteCache.get(cacheKey)!;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const size = 36;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          const fallback = getSeedPalette(fallbackSeed);
          paletteCache.set(cacheKey, fallback);
          resolve(fallback);
          return;
        }

        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        let bestScore = -1;
        let bestHue = 235;
        let secondHue = 275;

        for (let i = 0; i < data.length; i += 16) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 128) continue;

          const [h, s, l] = rgbToHsl(r, g, b);
          // Favor saturated mid-tone pixels from album artwork
          if (l > 0.12 && l < 0.88 && s > 0.18) {
            const score = s * 2.2 + (1 - Math.abs(l - 0.5));
            if (score > bestScore) {
              secondHue = bestHue;
              bestHue = h;
              bestScore = score;
            }
          }
        }

        if (bestScore < 0) {
          const fallback = getSeedPalette(fallbackSeed);
          paletteCache.set(cacheKey, fallback);
          resolve(fallback);
          return;
        }

        const hueDelta = Math.abs(bestHue - secondHue) > 20 ? secondHue - bestHue : 42;
        const extracted = buildPaletteFromHue(bestHue, hueDelta);
        paletteCache.set(cacheKey, extracted);
        resolve(extracted);
      } catch {
        const fallback = getSeedPalette(fallbackSeed);
        paletteCache.set(cacheKey, fallback);
        resolve(fallback);
      }
    };

    img.onerror = () => {
      const fallback = getSeedPalette(fallbackSeed);
      paletteCache.set(cacheKey, fallback);
      resolve(fallback);
    };

    img.src = coverArtUrl;
  });
}
