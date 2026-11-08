export interface SpotifyCanvasItem {
  id: string;
  canvasUrl: string;
  trackUri: string;
  artist?: {
    artistUri?: string;
    artistName?: string;
    artistImgUrl?: string;
  };
  otherId?: string;
  canvasUri?: string;
}

export interface SpotifyCanvasApiResponse {
  data?: {
    canvasesList?: SpotifyCanvasItem[];
  };
  canvasesList?: SpotifyCanvasItem[];
}

export interface CanvasRemoteProvider {
  readonly name: string;
  getBaseUrl(): string;
  setBaseUrl(url: string): void;
  fetchCanvas(spotifyTrackId: string): Promise<SpotifyCanvasItem | null>;
  downloadVideo(canvasUrl: string): Promise<Buffer | null>;
}

/**
 * Extracts a 22-character Spotify Track ID from:
 * - Spotify URI: "spotify:track:3OHfY25tqY28d16oZczHc8"
 * - Spotify URL: "https://open.spotify.com/track/3OHfY25tqY28d16oZczHc8?si=..."
 * - Spotify-Canva API URL: "https://.../api/canvas?trackId=3OHfY25tqY28d16oZczHc8"
 * - Raw 22-character base62 Spotify Track ID: "3OHfY25tqY28d16oZczHc8"
 */
export function extractSpotifyTrackId(rawInput: string | null | undefined): string | null {
  if (!rawInput) return null;
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  // 1. spotify:track:{id}
  const uriMatch = trimmed.match(/spotify:track:([A-Za-z0-9]{22})/i);
  if (uriMatch?.[1]) {
    return uriMatch[1];
  }

  // 2. open.spotify.com/(intl-xx/)?track/{id}
  const urlMatch = trimmed.match(/spotify\.com\/(?:intl-[a-zA-Z-]+\/)?track\/([A-Za-z0-9]{22})/i);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  // 3. ?trackId={id}
  const queryMatch = trimmed.match(/[?&]trackId=([A-Za-z0-9]{22})/i);
  if (queryMatch?.[1]) {
    return queryMatch[1];
  }

  // 4. Direct 22-character Spotify base62 ID
  if (/^[A-Za-z0-9]{22}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

const API_TIMEOUT_MS = 7000;
const VIDEO_DOWNLOAD_TIMEOUT_MS = 14000;
const MAX_SINGLE_VIDEO_BYTES = 25 * 1024 * 1024; // 25MB max per single canvas .mp4

/**
 * Swappable implementation for https://github.com/punisher-303/Spotify-Canva
 * Endpoint: GET /api/canvas?trackId={trackId}
 * Response: { data: { canvasesList: [{ id, canvasUrl, trackUri, artist, otherId, canvasUri }] } }
 */
export class PunisherSpotifyCanvaProvider implements CanvasRemoteProvider {
  public readonly name = 'punisher-303/Spotify-Canva';
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (
      baseUrl ||
      process.env.SPOTIFY_CANVAS_API_URL ||
      'https://spotify-canva.vercel.app'
    ).replace(/\/+$/, '');
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public setBaseUrl(url: string): void {
    const cleaned = url.trim().replace(/\/+$/, '');
    if (cleaned) {
      this.baseUrl = cleaned;
    }
  }

  public async fetchCanvas(rawTrackIdOrUri: string): Promise<SpotifyCanvasItem | null> {
    const trackId = extractSpotifyTrackId(rawTrackIdOrUri);
    if (!trackId) return null;

    const endpoint = `${this.baseUrl}/api/canvas?trackId=${encodeURIComponent(trackId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Aestheticy-MusicPlayer/1.0',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        return null;
      }

      const json = (await res.json()) as SpotifyCanvasApiResponse;
      const list = json?.data?.canvasesList || json?.canvasesList;
      if (!Array.isArray(list) || list.length === 0) {
        return null;
      }

      const first = list.find((item) => item && typeof item.canvasUrl === 'string' && item.canvasUrl.startsWith('http'));
      if (!first) {
        return null;
      }

      return {
        id: first.id || trackId,
        canvasUrl: first.canvasUrl,
        trackUri: first.trackUri || `spotify:track:${trackId}`,
        artist: first.artist,
        otherId: first.otherId,
        canvasUri: first.canvasUri,
      };
    } catch {
      // Never throw or surface errors to the user
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  public async downloadVideo(canvasUrl: string): Promise<Buffer | null> {
    if (!canvasUrl || !/^https?:\/\//i.test(canvasUrl)) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VIDEO_DOWNLOAD_TIMEOUT_MS);

    try {
      const res = await fetch(canvasUrl, {
        method: 'GET',
        headers: {
          Accept: 'video/mp4,video/*,*/*;q=0.8',
          'User-Agent': 'Aestheticy-MusicPlayer/1.0',
        },
        signal: controller.signal,
      });

      if (!res.ok) return null;

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('text/html') || contentType.includes('application/json')) {
        return null;
      }

      const contentLength = Number(res.headers.get('content-length') || 0);
      if (contentLength > MAX_SINGLE_VIDEO_BYTES) {
        return null;
      }

      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength < 512 || arrayBuffer.byteLength > MAX_SINGLE_VIDEO_BYTES) {
        return null;
      }

      return Buffer.from(arrayBuffer);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Attempts to automatically resolve a 22-char Spotify Track ID for a local track
 * using its ISRC or metadata (via lrc.red JSON metadata or Songlink/Odesli API).
 * Fails silently and returns null if no automatic match is found.
 */
export async function resolveSpotifyTrackIdAutomatically(params: {
  isrc: string | null;
  title: string;
  artist: string;
  cachedLyricsMetadataJson?: string | null;
}): Promise<string | null> {
  // 1. Check cached lyrics metadata JSON if present
  if (params.cachedLyricsMetadataJson) {
    try {
      const meta = JSON.parse(params.cachedLyricsMetadataJson);
      const candidate =
        meta?.spotifyId ||
        meta?.spotifyTrackId ||
        meta?.spotify_track_id ||
        meta?.spotifyUri ||
        meta?.spotifyUrl;
      const extracted = extractSpotifyTrackId(candidate);
      if (extracted) return extracted;
    } catch {
      // ignore
    }
  }

  // 2. If track has an ISRC, check lrc.red/{ISRC}.json for spotify track ID
  if (params.isrc) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const res = await fetch(
        `https://lrc.red/s/${encodeURIComponent(params.isrc)}.json`,
        {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        }
      );
      if (res.ok) {
        const data = (await res.json()) as Record<string, any>;
        const candidate =
          data?.spotifyId ||
          data?.spotifyTrackId ||
          data?.spotify_id ||
          data?.spotifyUri ||
          data?.spotify;
        const extracted = extractSpotifyTrackId(candidate);
        if (extracted) return extracted;
      }
    } catch {
      // ignore
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}

let activeCanvasProvider: CanvasRemoteProvider = new PunisherSpotifyCanvaProvider();

export function getCanvasRemoteProvider(): CanvasRemoteProvider {
  return activeCanvasProvider;
}

export function setCanvasRemoteProvider(provider: CanvasRemoteProvider): void {
  activeCanvasProvider = provider;
}
