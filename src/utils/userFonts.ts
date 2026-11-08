import type { UserFont } from '../shared/ipcTypes.ts';
import { ipcClient } from '../services/ipcClient.ts';

export interface FontPreset {
  label: string;
  hint: string;
  /** CSS family placed in front of the default stack; '' = the app default. */
  family: string;
}

export const FONT_PRESETS: FontPreset[] = [
  { label: 'Aestheticy default', hint: 'SF Pro if installed, otherwise Inter', family: '' },
  { label: 'SF Pro (Apple Music)', hint: 'Apple\u2019s system font, needs to be installed', family: 'SF Pro Text' },
  { label: 'Inter', hint: 'Bundled with the app', family: 'Inter' },
  { label: 'Segoe UI Variable', hint: 'Windows 11 system font', family: 'Segoe UI Variable Text' },
  { label: 'Segoe UI', hint: 'Windows system font', family: 'Segoe UI' },
  { label: 'Arial', hint: 'Classic sans-serif', family: 'Arial' },
  { label: 'Georgia', hint: 'Serif, editorial look', family: 'Georgia' },
  { label: 'Cascadia Code', hint: 'Monospace', family: 'Cascadia Code' },
];

let measureCanvas: HTMLCanvasElement | null = null;

/** True when a font with this family name is installed on the computer (width-comparison trick). */
export function isFontInstalled(family: string): boolean {
  if (!family) return true;
  try {
    measureCanvas = measureCanvas ?? document.createElement('canvas');
    const ctx = measureCanvas.getContext('2d');
    if (!ctx) return false;
    const sample = 'mmmmmmmmmmlliWWW 0123 \u0627\u0644\u0639\u0631\u0628\u064a\u0629';
    const widthWith = (stack: string) => {
      ctx.font = `72px ${stack}`;
      return ctx.measureText(sample).width;
    };
    const safe = family.replace(/["\\]/g, '');
    return (
      widthWith(`"${safe}", monospace`) !== widthWith('monospace') ||
      widthWith(`"${safe}", serif`) !== widthWith('serif')
    );
  } catch {
    return false;
  }
}

const registered = new Set<string>();

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Loads the fonts the user added into the document so they can be used by name. */
export async function registerUserFonts(fonts: UserFont[]): Promise<void> {
  for (const font of fonts) {
    if (registered.has(font.id)) continue;
    try {
      const b64 = await ipcClient.getUserFontData(font.id);
      if (!b64) continue;
      const bytes = base64ToBytes(b64);
      const face = new FontFace(font.name, bytes.buffer as ArrayBuffer);
      await face.load();
      document.fonts.add(face);
      registered.add(font.id);
    } catch (err) {
      console.warn('Could not load font', font.name, err);
    }
  }
}

export async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Puts the chosen family in front of the app's font stacks (CSS var --font-user). */
export function applyFontFamily(family: string): void {
  const root = document.documentElement;
  const clean = family.replace(/["\;{}]/g, '').trim();
  if (clean) root.style.setProperty('--font-user', `"${clean}"`);
  else root.style.removeProperty('--font-user');
}
