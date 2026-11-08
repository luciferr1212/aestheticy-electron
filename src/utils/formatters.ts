import type { Track } from '../shared/ipcTypes.ts';

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const totalSec = Math.floor(seconds);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatTotalDurationHuman(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 min';
  const totalMins = Math.floor(seconds / 60);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs} hr ${mins} min`;
  }
  if (totalMins > 0) {
    return `${totalMins} min ${secs} sec`;
  }
  return `${secs} sec`;
}

export function getDeterministicPalette(seed: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const palettes: [string, string][] = [
    ['#1E1B4B', '#4338CA'],
    ['#0F172A', '#334155'],
    ['#141E30', '#243B55'],
    ['#1F1C2C', '#4A4368'],
    ['#0D1B2A', '#1B263B'],
    ['#18181B', '#3F3F46'],
  ];
  return palettes[Math.abs(hash) % palettes.length];
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0.0 MB';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(2)} GB`;
  }
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${mb.toFixed(1)} MB`;
  }
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}

export function formatSampleRate(hz?: number | null, bitDepth?: number | null): string | null {
  if (!hz || !Number.isFinite(hz) || hz <= 0) return null;
  const khz = hz / 1000;
  const khzStr = Number.isInteger(khz) ? `${khz} kHz` : `${khz.toFixed(1)} kHz`;
  if (bitDepth && Number.isFinite(bitDepth) && bitDepth > 0) {
    return `${bitDepth}-bit / ${khzStr}`;
  }
  return khzStr;
}

export function formatBitrate(kbps?: number | null): string | null {
  if (!kbps || !Number.isFinite(kbps) || kbps <= 0) return null;
  return `${Math.round(kbps)} kbps`;
}

const LOSSLESS_FORMATS = new Set([
  'FLAC',
  'WAV',
  'ALAC',
  'AIFF',
  'AIF',
  'APE',
  'WV',
  'WAVPACK',
  'DSF',
  'DFF',
  'DSD',
]);

export function isTrackLossless(track: Track | null | undefined): boolean {
  if (!track) return false;
  if (typeof track.isLossless === 'boolean') return track.isLossless;
  return LOSSLESS_FORMATS.has((track.format || '').toUpperCase());
}

const NON_NATIVE_FORMATS = new Set([
  'ALAC',
  'WMA',
  'APE',
  'WV',
  'AIFF',
  'AIF',
  'DSF',
  'DFF',
]);

export function requiresFfmpegTranscode(track: Track | null | undefined): boolean {
  if (!track) return false;
  const fmt = (track.format || '').toUpperCase();
  if (NON_NATIVE_FORMATS.has(fmt)) return true;
  if (track.codec && NON_NATIVE_FORMATS.has(track.codec.toUpperCase())) return true;
  return false;
}
