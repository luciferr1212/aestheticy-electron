export interface RemoteLyricsFetchResult {
  format: 'ttml' | 'lrc' | 'none';
  content: string | null;
  metadata: Record<string, any> | null;
  coverArtBuffer?: Buffer | null;
  coverArtExt?: '.jpg' | '.webp' | null;
  error?: string;
}

export interface RemoteLyricsProvider {
  readonly name: string;
  fetchByIsrc(isrc: string, options?: { fetchCoverArt?: boolean }): Promise<RemoteLyricsFetchResult>;
}

/**
 * Extracts a normalized 12-character ISRC from either a raw ISRC code
 * (e.g. "US-RC1-76-07839" or "USRC17607839") or a lrc.red URL
 * (e.g. "https://lrc.red/s/USRC17607839.ttml" or "https://lrc.red/s/USRC17607839").
 */
export function extractIsrcFromInput(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  // 1. Check if it's a lrc.red URL or path containing /s/{ISRC}
  const urlMatch = trimmed.match(/lrc\.red\/s\/([A-Za-z0-9-]{8,18})(?:\.(?:ttml|lrc|json|jpg|webp))?/i);
  if (urlMatch && urlMatch[1]) {
    const cleaned = urlMatch[1].replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (cleaned.length >= 8 && cleaned.length <= 15) {
      return cleaned;
    }
  }

  // 2. Check generic URL last path segment
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const base = parsed.pathname
        .split('/')
        .filter(Boolean)
        .pop()
        ?.replace(/\.(ttml|lrc|json|jpg|webp)$/i, '');
      if (base) {
        const cleaned = base.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(cleaned) || (cleaned.length >= 10 && cleaned.length <= 14)) {
          return cleaned;
        }
      }
    } catch {
      // fall through
    }
  }

  // 3. Direct ISRC string (with or without dashes)
  const stripped = trimmed
    .replace(/\.(ttml|lrc|json|jpg|webp)$/i, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();

  // Standard 12-char ISRC (CC-XXX-YY-NNNNN) or 10-14 alphanumeric identifier
  if (/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(stripped) || /^[A-Z0-9]{10,14}$/.test(stripped)) {
    return stripped;
  }

  return null;
}

const REQUEST_TIMEOUT_MS = 6500;

async function safeFetchText(url: string): Promise<{ ok: boolean; status: number; text: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Aestheticy-MusicPlayer/1.0',
        Accept: '*/*',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, status: res.status, text: null };
    }
    const text = await res.text();
    if (!text || !text.trim()) {
      return { ok: false, status: res.status, text: null };
    }
    return { ok: true, status: res.status, text };
  } catch {
    return { ok: false, status: 0, text: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function safeFetchBuffer(url: string): Promise<Buffer | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Aestheticy-MusicPlayer/1.0',
        Accept: 'image/webp,image/jpeg,image/*,*/*;q=0.8',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/html')) return null;
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength < 64) return null;
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Default lrc.red Remote Lyrics Provider
 * Endpoints:
 * - https://lrc.red/s/{ISRC}.ttml (word-level, preferred)
 * - https://lrc.red/s/{ISRC}.lrc (line-level fallback)
 * - https://lrc.red/s/{ISRC}.json (metadata)
 * - https://lrc.red/s/{ISRC}.jpg or .webp (cover art fallback if the file has none)
 */
export class LrcRedProvider implements RemoteLyricsProvider {
  public readonly name = 'lrc.red';
  private baseUrl: string;

  constructor(baseUrl = 'https://lrc.red/s') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  public async fetchByIsrc(
    rawIsrc: string,
    options?: { fetchCoverArt?: boolean }
  ): Promise<RemoteLyricsFetchResult> {
    const isrc = extractIsrcFromInput(rawIsrc);
    if (!isrc) {
      return {
        format: 'none',
        content: null,
        metadata: null,
        error: 'Invalid ISRC format',
      };
    }

    const ttmlUrl = `${this.baseUrl}/${encodeURIComponent(isrc)}.ttml`;
    const lrcUrl = `${this.baseUrl}/${encodeURIComponent(isrc)}.lrc`;
    const jsonUrl = `${this.baseUrl}/${encodeURIComponent(isrc)}.json`;

    // Fetch metadata JSON in parallel (non-critical if missing)
    const metadataPromise = safeFetchText(jsonUrl).then((res) => {
      if (!res.ok || !res.text) return null;
      try {
        return JSON.parse(res.text) as Record<string, any>;
      } catch {
        return null;
      }
    });

    // Optional cover art fallback if track has no embedded cover art
    const coverArtPromise: Promise<{ buf: Buffer | null; ext: '.jpg' | '.webp' | null }> =
      options?.fetchCoverArt
        ? (async () => {
            const jpgUrl = `${this.baseUrl}/${encodeURIComponent(isrc)}.jpg`;
            const jpgBuf = await safeFetchBuffer(jpgUrl);
            if (jpgBuf) return { buf: jpgBuf, ext: '.jpg' as const };

            const webpUrl = `${this.baseUrl}/${encodeURIComponent(isrc)}.webp`;
            const webpBuf = await safeFetchBuffer(webpUrl);
            if (webpBuf) return { buf: webpBuf, ext: '.webp' as const };

            return { buf: null, ext: null };
          })()
        : Promise.resolve({ buf: null, ext: null });

    // 1. Try TTML (preferred word-level lyrics)
    const ttmlRes = await safeFetchText(ttmlUrl);
    if (ttmlRes.ok && ttmlRes.text && ttmlRes.text.includes('<tt')) {
      const [metadata, cover] = await Promise.all([metadataPromise, coverArtPromise]);
      return {
        format: 'ttml',
        content: ttmlRes.text,
        metadata,
        coverArtBuffer: cover.buf,
        coverArtExt: cover.ext,
      };
    }

    // 2. Fallback to LRC (line-level lyrics)
    const lrcRes = await safeFetchText(lrcUrl);
    if (lrcRes.ok && lrcRes.text && /\[\d{1,3}:\d{2}/.test(lrcRes.text)) {
      const [metadata, cover] = await Promise.all([metadataPromise, coverArtPromise]);
      return {
        format: 'lrc',
        content: lrcRes.text,
        metadata,
        coverArtBuffer: cover.buf,
        coverArtExt: cover.ext,
      };
    }

    const [metadata, cover] = await Promise.all([metadataPromise, coverArtPromise]);
    const networkDown = ttmlRes.status === 0 && lrcRes.status === 0;

    return {
      format: 'none',
      content: null,
      metadata,
      coverArtBuffer: cover.buf,
      coverArtExt: cover.ext,
      error: networkDown
        ? 'Could not reach lrc.red (offline or service unavailable)'
        : `No synced lyrics found on lrc.red for ISRC ${isrc}`,
    };
  }
}

let activeRemoteProvider: RemoteLyricsProvider = new LrcRedProvider();

export function getRemoteLyricsProvider(): RemoteLyricsProvider {
  return activeRemoteProvider;
}

export function setRemoteLyricsProvider(provider: RemoteLyricsProvider): void {
  activeRemoteProvider = provider;
}
