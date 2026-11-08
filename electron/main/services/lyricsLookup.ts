/**
 * Automatic lyrics discovery helpers (no ISRC needed from the user).
 *
 *  - LRCLIB (https://lrclib.net): free community database of synced (.lrc) lyrics. Searched by
 *    artist + title (+ album + duration), so it works for ordinary local files.
 *  - MusicBrainz (https://musicbrainz.org): used to discover the ISRC of a recording so the
 *    richer word-synced lrc.red TTML can be used as well. Requests are rate-limited to 1/second
 *    as required by their API policy.
 *
 * Every function is best-effort: on any network/parse problem it resolves with `null`.
 */

const USER_AGENT = 'Aestheticy/1.0 (https://github.com/aestheticy/aestheticy)';
const TIMEOUT_MS = 7000;

async function getJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface LrclibRecord {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export interface LookupQuery {
  title: string;
  artist: string;
  album?: string | null;
  duration?: number | null;
}

function clean(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/\s*[\[(](?:feat|ft|with)\.?[^\])]*[\])]/gi, '')
    .replace(/\s*-\s*(?:remaster(?:ed)?(?:\s*\d{4})?|\d{4}\s*remaster(?:ed)?|live|radio edit|single version|mono|stereo).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Returns the .lrc text (synced lyrics) from LRCLIB, or null. */
export async function fetchSyncedFromLrclib(q: LookupQuery): Promise<{ lrc: string; source: LrclibRecord } | null> {
  const title = clean(q.title);
  const artist = clean(q.artist);
  if (!title) return null;

  // 1) Exact signature match (best accuracy; uses duration when we have it).
  if (artist) {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    if (q.album) params.set('album_name', clean(q.album));
    if (q.duration && q.duration > 0) params.set('duration', String(Math.round(q.duration)));
    const exact = await getJson<LrclibRecord>(`https://lrclib.net/api/get?${params.toString()}`);
    if (exact?.syncedLyrics && /\[\d{1,3}:\d{2}/.test(exact.syncedLyrics)) {
      return { lrc: exact.syncedLyrics, source: exact };
    }
  }

  // 2) Fuzzy search, then pick the closest candidate that has synced lyrics.
  const sp = new URLSearchParams({ track_name: title });
  if (artist) sp.set('artist_name', artist);
  let results = await getJson<LrclibRecord[]>(`https://lrclib.net/api/search?${sp.toString()}`);
  if ((!results || results.length === 0) && artist) {
    results = await getJson<LrclibRecord[]>(
      `https://lrclib.net/api/search?q=${encodeURIComponent(`${artist} ${title}`)}`
    );
  }
  if (!results || results.length === 0) return null;

  const wantTitle = norm(title);
  const wantArtist = norm(artist);
  let best: { rec: LrclibRecord; score: number } | null = null;
  for (const rec of results) {
    if (!rec.syncedLyrics || !/\[\d{1,3}:\d{2}/.test(rec.syncedLyrics)) continue;
    let score = 0;
    const t = norm(rec.trackName);
    const a = norm(rec.artistName);
    if (t === wantTitle) score += 4;
    else if (t.includes(wantTitle) || wantTitle.includes(t)) score += 2;
    else continue; // title must at least be related
    if (wantArtist) {
      if (a === wantArtist) score += 3;
      else if (a.includes(wantArtist) || wantArtist.includes(a)) score += 1.5;
      else score -= 2;
    }
    if (q.duration && rec.duration) {
      const diff = Math.abs(rec.duration - q.duration);
      if (diff <= 2) score += 3;
      else if (diff <= 5) score += 1;
      else if (diff > 15) score -= 3;
    }
    if (!best || score > best.score) best = { rec, score };
  }
  if (best && best.score >= 4) {
    return { lrc: best.rec.syncedLyrics as string, source: best.rec };
  }
  return null;
}

// --- MusicBrainz ISRC discovery -------------------------------------------------------------

let lastMusicBrainzCall = 0;

async function throttleMusicBrainz(): Promise<void> {
  const wait = lastMusicBrainzCall + 1100 - Date.now();
  lastMusicBrainzCall = Date.now() + Math.max(0, wait);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

interface MbRecording {
  id: string;
  score?: number;
  title?: string;
  length?: number;
  isrcs?: string[];
  'artist-credit'?: Array<{ name?: string; artist?: { name?: string } }>;
}

/** Looks up an ISRC for the recording on MusicBrainz. Returns a 12-char ISRC or null. */
export async function lookupIsrcOnMusicBrainz(q: LookupQuery): Promise<string | null> {
  const title = clean(q.title);
  const artist = clean(q.artist);
  if (!title || !artist) return null;

  const esc = (s: string) => s.replace(/(["\\])/g, '\\$1');
  const query = `recording:"${esc(title)}" AND artist:"${esc(artist)}"`;
  await throttleMusicBrainz();
  const data = await getJson<{ recordings?: MbRecording[] }>(
    `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&limit=8&fmt=json`
  );
  const list = data?.recordings;
  if (!list || list.length === 0) return null;

  const wantTitle = norm(title);
  const wantArtist = norm(artist);
  for (const rec of list) {
    if ((rec.score ?? 0) < 90) continue;
    if (!rec.isrcs || rec.isrcs.length === 0) continue;
    if (norm(rec.title) !== wantTitle) continue;
    const credit = (rec['artist-credit'] ?? [])
      .map((c) => c.name ?? c.artist?.name ?? '')
      .join(' ');
    const a = norm(credit);
    if (wantArtist && !(a.includes(wantArtist) || wantArtist.includes(a))) continue;
    if (q.duration && rec.length) {
      if (Math.abs(rec.length / 1000 - q.duration) > 4) continue;
    }
    const isrc = rec.isrcs[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) return isrc;
  }
  return null;
}
