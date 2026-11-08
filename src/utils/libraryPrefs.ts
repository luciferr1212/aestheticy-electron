import type { AlbumSummary, ArtistSummary, Track } from '../shared/ipcTypes.ts';
import { isTrackLossless } from './formatters.ts';

export type SortDir = 'asc' | 'desc';
export type GridMode = 'square' | 'wide' | 'list';

export type SongSortKey = 'default' | 'title' | 'artist' | 'album' | 'year' | 'added' | 'duration';
export type AlbumSortKey = 'name' | 'artist' | 'year' | 'songs' | 'duration';
export type ArtistSortKey = 'name' | 'songs' | 'albums' | 'duration';

export const SONG_SORT_OPTIONS: Array<{ key: SongSortKey; label: string }> = [
  { key: 'default', label: 'Default' },
  { key: 'title', label: 'Title (A–Z)' },
  { key: 'artist', label: 'Artist (A–Z)' },
  { key: 'album', label: 'Album (A–Z)' },
  { key: 'year', label: 'Year' },
  { key: 'added', label: 'Recently added' },
  { key: 'duration', label: 'Length' },
];

export const ALBUM_SORT_OPTIONS: Array<{ key: AlbumSortKey; label: string }> = [
  { key: 'name', label: 'Album (A–Z)' },
  { key: 'artist', label: 'Artist (A–Z)' },
  { key: 'year', label: 'Year' },
  { key: 'songs', label: 'Number of songs' },
  { key: 'duration', label: 'Length' },
];

export const ARTIST_SORT_OPTIONS: Array<{ key: ArtistSortKey; label: string }> = [
  { key: 'name', label: 'Name (A–Z)' },
  { key: 'songs', label: 'Number of songs' },
  { key: 'albums', label: 'Number of albums' },
  { key: 'duration', label: 'Length' },
];

// ---------------------------------------------------------------------------------------------
// Persistence (per-viewer UI preferences; failing storage must never break the app)
// ---------------------------------------------------------------------------------------------

const PREFIX = 'aestheticy.ui.';

export function loadPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = window.localStorage.getItem(PREFIX + key);
    if (v && (allowed as readonly string[]).includes(v)) return v as T;
  } catch {
    // ignore
  }
  return fallback;
}

export function savePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------------------------

const collator =
  typeof Intl !== 'undefined'
    ? new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
    : null;

export function compareText(a: string | null | undefined, b: string | null | undefined): number {
  const x = (a ?? '').trim();
  const y = (b ?? '').trim();
  return collator ? collator.compare(x, y) : x.localeCompare(y);
}

/** Missing numbers always sink to the bottom regardless of direction. */
function compareNum(a: number | null | undefined, b: number | null | undefined, dir: SortDir): number {
  const am = a == null || !Number.isFinite(a) || a === 0;
  const bm = b == null || !Number.isFinite(b) || b === 0;
  if (am && bm) return 0;
  if (am) return 1;
  if (bm) return -1;
  return dir === 'asc' ? (a as number) - (b as number) : (b as number) - (a as number);
}

function applyDir(n: number, dir: SortDir): number {
  return dir === 'asc' ? n : -n;
}

export function sortTracks(tracks: Track[], key: SongSortKey, dir: SortDir): Track[] {
  if (key === 'default') return tracks;
  const out = [...tracks];
  out.sort((a, b) => {
    switch (key) {
      case 'title':
        return applyDir(compareText(a.title, b.title), dir);
      case 'artist':
        return (
          applyDir(compareText(a.artist, b.artist), dir) ||
          compareText(a.album, b.album) ||
          (a.trackNumber ?? 0) - (b.trackNumber ?? 0)
        );
      case 'album':
        return (
          applyDir(compareText(a.album, b.album), dir) ||
          (a.trackNumber ?? 0) - (b.trackNumber ?? 0)
        );
      case 'year':
        return compareNum(a.year, b.year, dir) || compareText(a.album, b.album);
      case 'added':
        return compareNum(a.modifiedAt, b.modifiedAt, dir);
      case 'duration':
        return compareNum(a.duration, b.duration, dir);
      default:
        return 0;
    }
  });
  return out;
}

export function sortAlbums(items: AlbumSummary[], key: AlbumSortKey, dir: SortDir): AlbumSummary[] {
  const out = [...items];
  out.sort((a, b) => {
    switch (key) {
      case 'name':
        return applyDir(compareText(a.album, b.album), dir);
      case 'artist':
        return applyDir(compareText(a.artist, b.artist), dir) || compareText(a.album, b.album);
      case 'year':
        return compareNum(a.year, b.year, dir) || compareText(a.album, b.album);
      case 'songs':
        return compareNum(a.trackCount, b.trackCount, dir);
      case 'duration':
        return compareNum(a.totalDuration, b.totalDuration, dir);
    }
  });
  return out;
}

export function sortArtists(items: ArtistSummary[], key: ArtistSortKey, dir: SortDir): ArtistSummary[] {
  const out = [...items];
  out.sort((a, b) => {
    switch (key) {
      case 'name':
        return applyDir(compareText(a.artist, b.artist), dir);
      case 'songs':
        return compareNum(a.trackCount, b.trackCount, dir) || compareText(a.artist, b.artist);
      case 'albums':
        return compareNum(a.albumCount, b.albumCount, dir) || compareText(a.artist, b.artist);
      case 'duration':
        return compareNum(a.totalDuration, b.totalDuration, dir);
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Extra categories: Years, Folders, Quality (derived client-side from the track list)
// ---------------------------------------------------------------------------------------------

export type CategoryKind = 'years' | 'folders' | 'quality';

export interface CategoryGroup {
  key: string;
  label: string;
  sublabel?: string;
  trackCount: number;
  totalDuration: number;
  coverArtUrl: string | null;
  tracks: Track[];
  sortValue: number;
}

function addToGroup(
  map: Map<string, CategoryGroup>,
  key: string,
  label: string,
  sortValue: number,
  track: Track,
  sublabel?: string
): void {
  let g = map.get(key);
  if (!g) {
    g = {
      key,
      label,
      sublabel,
      trackCount: 0,
      totalDuration: 0,
      coverArtUrl: null,
      tracks: [],
      sortValue,
    };
    map.set(key, g);
  }
  g.tracks.push(track);
  g.trackCount += 1;
  g.totalDuration += track.duration || 0;
  if (!g.coverArtUrl && track.coverArtUrl) g.coverArtUrl = track.coverArtUrl;
}

function dirOf(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return idx > 0 ? filePath.slice(0, idx) : filePath;
}

function lastSegment(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

export type QualityTier = 'hires' | 'lossless' | 'high' | 'standard' | 'unknown';

export const QUALITY_LABELS: Record<QualityTier, { label: string; hint: string; order: number }> = {
  hires: { label: 'Hi-Res Lossless', hint: '24-bit and/or above 48 kHz', order: 0 },
  lossless: { label: 'Lossless (CD quality)', hint: 'FLAC / ALAC / WAV up to 16-bit 48 kHz', order: 1 },
  high: { label: 'High quality lossy', hint: '256 kbps and above', order: 2 },
  standard: { label: 'Standard lossy', hint: 'Below 256 kbps', order: 3 },
  unknown: { label: 'Unknown quality', hint: 'No bitrate information', order: 4 },
};

export function getQualityTier(track: Track): QualityTier {
  if (isTrackLossless(track)) {
    const bits = track.bitDepth ?? 0;
    const rate = track.sampleRate ?? 0;
    if (bits > 16 || rate > 48000) return 'hires';
    return 'lossless';
  }
  const br = track.bitrate ?? 0;
  if (br >= 256) return 'high';
  if (br > 0) return 'standard';
  return 'unknown';
}

export function buildCategoryGroups(kind: CategoryKind, tracks: Track[]): CategoryGroup[] {
  const map = new Map<string, CategoryGroup>();
  for (const t of tracks) {
    if (kind === 'years') {
      const y = t.year && t.year > 0 ? t.year : 0;
      addToGroup(map, String(y), y ? String(y) : 'Unknown year', y, t);
    } else if (kind === 'folders') {
      const dir = dirOf(t.filePath || '');
      addToGroup(map, dir, lastSegment(dir) || 'Music', 0, t, dir);
    } else {
      const tier = getQualityTier(t);
      const meta = QUALITY_LABELS[tier];
      addToGroup(map, tier, meta.label, meta.order, t, meta.hint);
    }
  }
  const groups = Array.from(map.values());
  if (kind === 'years') {
    groups.sort((a, b) => {
      if (a.sortValue === 0) return 1;
      if (b.sortValue === 0) return -1;
      return b.sortValue - a.sortValue;
    });
  } else if (kind === 'folders') {
    groups.sort((a, b) => compareText(a.label, b.label));
  } else {
    groups.sort((a, b) => a.sortValue - b.sortValue);
  }
  return groups;
}
