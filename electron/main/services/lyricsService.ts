import { fetchSyncedFromLrclib, lookupIsrcOnMusicBrainz } from './lyricsLookup.ts';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { sqliteManager } from '../db/sqlite.ts';
import {
  extractIsrcFromInput,
  getRemoteLyricsProvider,
} from './lrcRedProvider.ts';
import type {
  LyricLine,
  LyricsCacheStats,
  LyricsResult,
  LyricWord,
} from '../../../src/shared/ipcTypes.ts';
import { getDataDir } from '../dataDir.ts';

/**
 * Converts a TTML or LRC timestamp string into seconds (float).
 * Supports:
 * - "HH:MM:SS.mmm" or "HH:MM:SS:ff"
 * - "MM:SS.mmm"
 * - "12.345s" or "12.345"
 * - "12345ms"
 */
export function parseTimestampToSeconds(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  if (s.endsWith('ms')) {
    const ms = parseFloat(s.slice(0, -2));
    return Number.isFinite(ms) ? ms / 1000 : null;
  }

  if (s.endsWith('s')) {
    const sec = parseFloat(s.slice(0, -1));
    return Number.isFinite(sec) ? sec : null;
  }

  const parts = s.split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]);
    const mins = parseFloat(parts[1]);
    const secs = parseFloat(parts[2]);
    if (Number.isFinite(hours) && Number.isFinite(mins) && Number.isFinite(secs)) {
      return hours * 3600 + mins * 60 + secs;
    }
  } else if (parts.length === 2) {
    const mins = parseFloat(parts[0]);
    const secs = parseFloat(parts[1]);
    if (Number.isFinite(mins) && Number.isFinite(secs)) {
      return mins * 60 + secs;
    }
  } else if (parts.length === 1) {
    const secs = parseFloat(parts[0]);
    if (Number.isFinite(secs)) {
      return secs;
    }
  }

  return null;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode( parseInt(dec, 10) ))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode( parseInt(hex, 16) ));
}

function getXmlAttr(attrsStr: string, attrName: string): string | undefined {
  // Match either exact attrName or namespace-prefixed attrName
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?:^|\\s)(?:[a-zA-Z0-9_-]+:)?${escaped}\\s*=\\s*["']([^"']*)["']`, 'i');
  const match = attrsStr.match(regex);
  return match ? match[1] : undefined;
}

/**
 * Extracts timed word `<span>` elements from a fragment of TTML inner HTML.
 * Preserves whether each word/syllable has trailing whitespace.
 */
function parseTtmlWordSpans(
  fragmentHtml: string,
  fallbackBegin: number,
  fallbackEnd: number
): { words: LyricWord[]; plainText: string } {
  const words: LyricWord[] = [];
  const spanRegex = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;

  let match: RegExpExecArray | null;
  const matches: Array<{
    fullMatch: string;
    index: number;
    endIndex: number;
    attrs: string;
    inner: string;
  }> = [];

  while ((match = spanRegex.exec(fragmentHtml)) !== null) {
    matches.push({
      fullMatch: match[0],
      index: match.index,
      endIndex: match.index + match[0].length,
      attrs: match[1],
      inner: match[2],
    });
  }

  if (matches.length === 0) {
    const clean = decodeXmlEntities(fragmentHtml.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    return { words: [], plainText: clean };
  }

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];

    const rawText = decodeXmlEntities(current.inner.replace(/<[^>]+>/g, ''));
    const hasInternalTrailingSpace = /\s$/.test(rawText);
    const betweenText = next
      ? fragmentHtml.slice(current.endIndex, next.index)
      : '';
    const hasBetweenSpace = /\s/.test(betweenText);

    const cleanWordText = rawText.trim();
    if (!cleanWordText) continue;

    const begin = parseTimestampToSeconds(getXmlAttr(current.attrs, 'begin')) ?? fallbackBegin;
    const end = parseTimestampToSeconds(getXmlAttr(current.attrs, 'end')) ?? fallbackEnd;

    words.push({
      text: cleanWordText,
      begin,
      end: Math.max(begin + 0.02, end),
      trailingSpace: i < matches.length - 1 ? hasInternalTrailingSpace || hasBetweenSpace : false,
    });
  }

  const plainText = words
    .map((w) => w.text + (w.trailingSpace ? ' ' : ''))
    .join('')
    .trim();

  return { words, plainText };
}

/**
 * Parses Apple Music / lrc.red TTML XML into structured LyricLine[] with word-level
 * begin/end times, background vocals (`ttm:role="x-bg"`), and singer agents (`ttm:agent="v1"`).
 */
export function parseTtmlLyrics(ttmlContent: string): {
  lines: LyricLine[];
  isWordSynced: boolean;
} {
  const lines: LyricLine[] = [];
  let hasAnyWords = false;

  const pRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let pMatch: RegExpExecArray | null;
  let lineIndex = 0;

  while ((pMatch = pRegex.exec(ttmlContent)) !== null) {
    const pAttrs = pMatch[1];
    let pInner = pMatch[2];

    const pBegin = parseTimestampToSeconds(getXmlAttr(pAttrs, 'begin'));
    const pEnd = parseTimestampToSeconds(getXmlAttr(pAttrs, 'end'));
    const agent = getXmlAttr(pAttrs, 'agent');
    const role = getXmlAttr(pAttrs, 'role');
    const isStandaloneBg = role === 'x-bg';

    // Check for nested background vocal <span ... ttm:role="x-bg" ...>...</span>
    // Because background spans may themselves contain nested word <span>s, we locate `<span` with `x-bg`
    let backgroundText: string | undefined;
    let backgroundWords: LyricWord[] | undefined;
    let backgroundBegin: number | undefined;
    let backgroundEnd: number | undefined;

    const bgOpenRegex = /<span\b([^>]*\brole\s*=\s*["']x-bg["'][^>]*)>/i;
    const bgOpenMatch = bgOpenRegex.exec(pInner);

    if (bgOpenMatch && !isStandaloneBg) {
      const bgAttrs = bgOpenMatch[1];
      const bgStartTagEnd = bgOpenMatch.index + bgOpenMatch[0].length;
      // Find matching closing </span> accounting for nested <span> tags
      let depth = 1;
      let scanPos = bgStartTagEnd;
      const tagTokenRegex = /<\/?span\b[^>]*>/gi;
      tagTokenRegex.lastIndex = bgStartTagEnd;
      let tokenMatch: RegExpExecArray | null;
      let bgCloseStart = -1;
      let bgCloseEnd = -1;

      while ((tokenMatch = tagTokenRegex.exec(pInner)) !== null) {
        if (tokenMatch[0].startsWith('</')) {
          depth--;
          if (depth === 0) {
            bgCloseStart = tokenMatch.index;
            bgCloseEnd = tokenMatch.index + tokenMatch[0].length;
            break;
          }
        } else if (!tokenMatch[0].endsWith('/>')) {
          depth++;
        }
      }

      if (bgCloseStart !== -1) {
        const bgInnerHtml = pInner.slice(bgStartTagEnd, bgCloseStart);
        const bgSpanBegin =
          parseTimestampToSeconds(getXmlAttr(bgAttrs, 'begin')) ?? pBegin ?? 0;
        const bgSpanEnd =
          parseTimestampToSeconds(getXmlAttr(bgAttrs, 'end')) ?? pEnd ?? bgSpanBegin + 2;

        const parsedBg = parseTtmlWordSpans(bgInnerHtml, bgSpanBegin, bgSpanEnd);
        if (parsedBg.plainText) {
          backgroundText = parsedBg.plainText.replace(/^\((.*)\)$/, '$1').trim();
          backgroundWords = parsedBg.words.map((w, idx, arr) => ({
            ...w,
            text:
              idx === 0 && idx === arr.length - 1
                ? w.text.replace(/^\((.*)\)$/, '$1')
                : idx === 0
                ? w.text.replace(/^\(/, '')
                : idx === arr.length - 1
                ? w.text.replace(/\)$/, '')
                : w.text,
          }));
          backgroundBegin =
            backgroundWords.length > 0 ? backgroundWords[0].begin : bgSpanBegin;
          backgroundEnd =
            backgroundWords.length > 0
              ? backgroundWords[backgroundWords.length - 1].end
              : bgSpanEnd;
          if (backgroundWords.length > 0) {
            hasAnyWords = true;
          }
        }

        // Remove the background vocal block from pInner so main vocal parsing doesn't duplicate it
        pInner = pInner.slice(0, bgOpenMatch.index) + pInner.slice(bgCloseEnd);
      }
    }

    const fallbackBegin = pBegin ?? (lines.length > 0 ? lines[lines.length - 1].end : 0);
    const fallbackEnd = pEnd ?? fallbackBegin + 4;

    const parsedMain = parseTtmlWordSpans(pInner, fallbackBegin, fallbackEnd);

    if (parsedMain.words.length > 0) {
      hasAnyWords = true;
    }

    const computedBegin =
      pBegin ??
      (parsedMain.words.length > 0
        ? parsedMain.words[0].begin
        : backgroundBegin ?? fallbackBegin);
    const computedEnd =
      pEnd ??
      (parsedMain.words.length > 0
        ? parsedMain.words[parsedMain.words.length - 1].end
        : backgroundEnd ?? computedBegin + 3.5);

    if (!parsedMain.plainText && !backgroundText) {
      continue;
    }

    lines.push({
      id: `ttml-line-${lineIndex++}`,
      begin: computedBegin,
      end: Math.max(computedBegin + 0.1, computedEnd),
      text: parsedMain.plainText || backgroundText || '',
      words: parsedMain.plainText ? parsedMain.words : backgroundWords || [],
      agent,
      isBackground: isStandaloneBg || (!parsedMain.plainText && Boolean(backgroundText)),
      backgroundText: parsedMain.plainText ? backgroundText : undefined,
      backgroundWords: parsedMain.plainText ? backgroundWords : undefined,
      backgroundBegin: parsedMain.plainText ? backgroundBegin : undefined,
      backgroundEnd: parsedMain.plainText ? backgroundEnd : undefined,
    });
  }

  lines.sort((a, b) => a.begin - b.begin);

  return {
    lines,
    isWordSynced: hasAnyWords,
  };
}

/**
 * Parses standard and enhanced LRC lyrics into LyricLine[].
 */
export function parseLrcLyrics(lrcContent: string): {
  lines: LyricLine[];
  isWordSynced: boolean;
} {
  const rawLines = lrcContent.split(/\r?\n/);
  const tempEntries: Array<{
    begin: number;
    text: string;
    words: LyricWord[];
    isBackground?: boolean;
    agent?: string;
  }> = [];

  let globalOffsetSec = 0;
  let hasWordTags = false;

  const offsetMatch = lrcContent.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
  if (offsetMatch) {
    const ms = parseInt(offsetMatch[1], 10);
    if (Number.isFinite(ms)) {
      globalOffsetSec = ms / 1000;
    }
  }

  const lineTimeRegex = /\[(\d{1,3}:\d{2}(?:\.\d{1,3})?)\]/g;
  const wordTimeRegex = /<(\d{1,3}:\d{2}(?:\.\d{1,3})?)>([^<]*)/g;

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const lineTimestamps: number[] = [];
    let match: RegExpExecArray | null;
    lineTimeRegex.lastIndex = 0;

    while ((match = lineTimeRegex.exec(trimmed)) !== null) {
      const sec = parseTimestampToSeconds(match[1]);
      if (sec !== null) {
        lineTimestamps.push(Math.max(0, sec - globalOffsetSec));
      }
    }

    if (lineTimestamps.length === 0) continue;

    const contentAfterTimestamps = trimmed.replace(/\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
    if (!contentAfterTimestamps) continue;

    // Check for singer prefix like "v1:" or "v2:" or "[bg]"
    let cleanLineText = contentAfterTimestamps;
    let agent: string | undefined;
    const agentMatch = cleanLineText.match(/^(v\d+)\s*:\s*/i);
    if (agentMatch) {
      agent = agentMatch[1].toLowerCase();
      cleanLineText = cleanLineText.slice(agentMatch[0].length).trim();
    }

    // Check for enhanced LRC word tags <mm:ss.xx>word
    const words: LyricWord[] = [];
    wordTimeRegex.lastIndex = 0;
    let wMatch: RegExpExecArray | null;
    const rawWords: Array<{ time: number; text: string }> = [];

    while ((wMatch = wordTimeRegex.exec(cleanLineText)) !== null) {
      const wSec = parseTimestampToSeconds(wMatch[1]);
      const wText = wMatch[2];
      if (wSec !== null && wText.trim()) {
        rawWords.push({
          time: Math.max(0, wSec - globalOffsetSec),
          text: wText,
        });
      }
    }

    if (rawWords.length > 0) {
      hasWordTags = true;
      for (let i = 0; i < rawWords.length; i++) {
        const curr = rawWords[i];
        const next = rawWords[i + 1];
        const hasTrailing = /\s$/.test(curr.text);
        words.push({
          text: curr.text.trim(),
          begin: curr.time,
          end: next ? Math.max(curr.time + 0.05, next.time) : curr.time + 0.6,
          trailingSpace: i < rawWords.length - 1 ? hasTrailing || true : false,
        });
      }
      cleanLineText = cleanLineText.replace(/<\d{1,3}:\d{2}(?:\.\d{1,3})?>/g, '').replace(/\s+/g, ' ').trim();
    }

    const isBackground = /^\([^)]+\)$/.test(cleanLineText);
    if (isBackground) {
      cleanLineText = cleanLineText.replace(/^\((.*)\)$/, '$1').trim();
    }

    for (const begin of lineTimestamps) {
      tempEntries.push({
        begin,
        text: cleanLineText,
        words,
        isBackground,
        agent,
      });
    }
  }

  tempEntries.sort((a, b) => a.begin - b.begin);

  const lines: LyricLine[] = tempEntries.map((entry, idx) => {
    const nextEntry = tempEntries[idx + 1];
    const end = nextEntry
      ? Math.max(entry.begin + 0.25, nextEntry.begin)
      : entry.words.length > 0
      ? entry.words[entry.words.length - 1].end
      : entry.begin + 4.5;

    return {
      id: `lrc-line-${idx}`,
      begin: entry.begin,
      end,
      text: entry.text,
      words: entry.words,
      agent: entry.agent,
      isBackground: entry.isBackground,
    };
  });

  return {
    lines,
    isWordSynced: hasWordTags,
  };
}

interface TrackDbRow {
  id: number;
  file_path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover_art_path: string | null;
  isrc: string | null;
  lyrics_offset: number;
}

interface LyricsCacheRow {
  track_id: number;
  isrc: string | null;
  format: string;
  content: string;
  metadata_json: string | null;
  source: string;
  fetched_at: number;
}

const MISS_TTL_MS = 6 * 60 * 60 * 1000;

export class LyricsService {
  private coverCacheDir: string;
  private missCache = new Map<number, number>();

  constructor() {
    this.coverCacheDir = path.join(getDataDir(), 'cache', 'covers');
    if (!fs.existsSync(this.coverCacheDir)) {
      fs.mkdirSync(this.coverCacheDir, { recursive: true });
    }
  }

  /**
   * Resolves synced lyrics for a track following the strict source order:
   * (1) Local .ttml or .lrc file next to the audio file with the same name
   * (2) Cached lyrics in SQLite
   * (3) MusicBrainz ISRC discovery -> lrc.red (.ttml preferred, .lrc fallback), then LRCLIB by artist/title
   */
  public async getLyrics(trackId: number, forceRefresh = false): Promise<LyricsResult> {
    const db = sqliteManager.getDatabase();
    const track = db
      .prepare<TrackDbRow>(
        `SELECT id, file_path, title, artist, album, duration, cover_art_path, isrc, COALESCE(lyrics_offset, 0) AS lyrics_offset
         FROM tracks WHERE id = ?`
      )
      .get(trackId);

    if (!track) {
      return {
        trackId,
        isrc: null,
        source: 'none',
        format: 'none',
        isWordSynced: false,
        lines: [],
        offset: 0,
        error: 'Track not found',
      };
    }

    const offset = Number(track.lyrics_offset || 0);
    const normalizedIsrc = track.isrc ? extractIsrcFromInput(track.isrc) : null;

    // =========================================================================
    // (1) Check for a .ttml or .lrc file next to the audio file with the same name
    // =========================================================================
    if (track.file_path && fs.existsSync(path.dirname(track.file_path))) {
      const audioDir = path.dirname(track.file_path);
      const baseName = path.basename(track.file_path, path.extname(track.file_path));
      const localTtmlPath = path.join(audioDir, `${baseName}.ttml`);
      const localLrcPath = path.join(audioDir, `${baseName}.lrc`);

      if (fs.existsSync(localTtmlPath)) {
        try {
          const content = fs.readFileSync(localTtmlPath, 'utf-8');
          const parsed = parseTtmlLyrics(content);
          if (parsed.lines.length > 0) {
            this.cacheLyricsInDb(track.id, normalizedIsrc, 'ttml', content, null, 'local-ttml');
            return {
              trackId: track.id,
              isrc: normalizedIsrc,
              source: 'local-ttml',
              format: 'ttml',
              isWordSynced: parsed.isWordSynced,
              lines: parsed.lines,
              offset,
            };
          }
        } catch {
          // Proceed to next source if local TTML read fails
        }
      }

      if (fs.existsSync(localLrcPath)) {
        try {
          const content = fs.readFileSync(localLrcPath, 'utf-8');
          const parsed = parseLrcLyrics(content);
          if (parsed.lines.length > 0) {
            this.cacheLyricsInDb(track.id, normalizedIsrc, 'lrc', content, null, 'local-lrc');
            return {
              trackId: track.id,
              isrc: normalizedIsrc,
              source: 'local-lrc',
              format: 'lrc',
              isWordSynced: parsed.isWordSynced,
              lines: parsed.lines,
              offset,
            };
          }
        } catch {
          // Proceed to next source if local LRC read fails
        }
      }
    }

    // =========================================================================
    // (2) Check cached lyrics in SQLite
    // =========================================================================
    if (!forceRefresh) {
      let cached = db
        .prepare<LyricsCacheRow>('SELECT * FROM lyrics_cache WHERE track_id = ?')
        .get(track.id);

      if (!cached && normalizedIsrc) {
        cached = db
          .prepare<LyricsCacheRow>('SELECT * FROM lyrics_cache WHERE isrc = ? LIMIT 1')
          .get(normalizedIsrc);
      }

      if (cached && cached.content) {
        const format = cached.format === 'ttml' ? 'ttml' : 'lrc';
        const parsed =
          format === 'ttml'
            ? parseTtmlLyrics(cached.content)
            : parseLrcLyrics(cached.content);

        if (parsed.lines.length > 0) {
          let remoteMetadata: Record<string, any> | null = null;
          if (cached.metadata_json) {
            try {
              remoteMetadata = JSON.parse(cached.metadata_json);
            } catch {
              remoteMetadata = null;
            }
          }
          return {
            trackId: track.id,
            isrc: normalizedIsrc || cached.isrc,
            source: 'cache',
            format,
            isWordSynced: parsed.isWordSynced,
            lines: parsed.lines,
            offset,
            remoteMetadata,
          };
        }
      }
    }

    // =========================================================================
    // (3) Online discovery (automatic, no manual ISRC needed):
    //     a. find the ISRC on MusicBrainz when the file has none
    //     b. lrc.red by ISRC (word-synced TTML preferred)
    //     c. LRCLIB by artist/title/album/duration (line-synced LRC)
    // =========================================================================
    if (!forceRefresh && !this.isOnlineLyricsEnabled()) {
      return {
        trackId: track.id,
        isrc: normalizedIsrc,
        source: 'none',
        format: 'none',
        isWordSynced: false,
        lines: [],
        offset,
        error:
          'Online lyrics fetching is turned off in Settings. Enable it in Settings → Lyrics & Canvas or place a local .ttml/.lrc file next to the song.',
      };
    }

    // Do not hammer the services for songs that already came up empty a moment ago.
    const lastMiss = this.missCache.get(track.id);
    if (!forceRefresh && lastMiss && Date.now() - lastMiss < MISS_TTL_MS) {
      return {
        trackId: track.id,
        isrc: normalizedIsrc,
        source: 'none',
        format: 'none',
        isWordSynced: false,
        lines: [],
        offset,
      };
    }

    let isrc = normalizedIsrc;
    if (!isrc) {
      isrc = await lookupIsrcOnMusicBrainz({
        title: track.title,
        artist: track.artist,
        duration: track.duration,
      }).catch(() => null);
      if (isrc) {
        try {
          db.prepare('UPDATE tracks SET isrc = ? WHERE id = ? AND (isrc IS NULL OR isrc = \'\')').run(
            isrc,
            track.id
          );
        } catch {
          // non-critical
        }
      }
    }

    let remoteError: string | undefined;
    let remoteMetadata: Record<string, any> | null = null;
    let updatedCoverArtUrl: string | null = null;

    if (isrc) {
      const provider = getRemoteLyricsProvider();
      const needsCoverFallback = !track.cover_art_path;
      const remoteResult = await provider.fetchByIsrc(isrc, {
        fetchCoverArt: needsCoverFallback,
      });
      remoteMetadata = remoteResult.metadata;

      if (needsCoverFallback && remoteResult.coverArtBuffer && remoteResult.coverArtExt) {
        updatedCoverArtUrl = this.saveFallbackCoverArtForTrack(
          track.id,
          isrc,
          remoteResult.coverArtBuffer,
          remoteResult.coverArtExt
        );
      }

      if (
        (remoteResult.format === 'ttml' || remoteResult.format === 'lrc') &&
        remoteResult.content
      ) {
        const parsed =
          remoteResult.format === 'ttml'
            ? parseTtmlLyrics(remoteResult.content)
            : parseLrcLyrics(remoteResult.content);

        if (parsed.lines.length > 0) {
          this.cacheLyricsInDb(
            track.id,
            isrc,
            remoteResult.format,
            remoteResult.content,
            remoteResult.metadata,
            'lrc.red'
          );
          this.missCache.delete(track.id);

          return {
            trackId: track.id,
            isrc,
            source: 'lrc.red',
            format: remoteResult.format,
            isWordSynced: parsed.isWordSynced,
            lines: parsed.lines,
            offset,
            coverArtUrl: updatedCoverArtUrl,
            remoteMetadata: remoteResult.metadata,
          };
        }
      }
      remoteError = remoteResult.error;
    }

    // LRCLIB fallback
    const lrclib = await fetchSyncedFromLrclib({
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
    }).catch(() => null);

    if (lrclib) {
      const parsed = parseLrcLyrics(lrclib.lrc);
      if (parsed.lines.length > 0) {
        this.cacheLyricsInDb(track.id, isrc, 'lrc', lrclib.lrc, null, 'lrclib');
        this.missCache.delete(track.id);
        return {
          trackId: track.id,
          isrc,
          source: 'lrclib',
          format: 'lrc',
          isWordSynced: parsed.isWordSynced,
          lines: parsed.lines,
          offset,
          coverArtUrl: updatedCoverArtUrl,
          remoteMetadata,
        };
      }
    }

    this.missCache.set(track.id, Date.now());
    const lowered = (remoteError || '').toLowerCase();
    const friendlyError = remoteError
      ? lowered.includes('fetch') || lowered.includes('network') || lowered.includes('enotfound') || lowered.includes('reach')
        ? 'Unable to connect to the online lyrics services. Please check your internet connection or use a local .lrc/.ttml file.'
        : remoteError
      : undefined;

    return {
      trackId: track.id,
      isrc,
      source: 'none',
      format: 'none',
      isWordSynced: false,
      lines: [],
      offset,
      coverArtUrl: updatedCoverArtUrl,
      remoteMetadata,
      error: friendlyError,
    };
  }

  /**
   * Saves the per-track lyrics timing offset (± up to 2.0 seconds) in SQLite.
   */
  public saveLyricsOffset(trackId: number, rawOffset: number): { offset: number } {
    const clamped = Math.max(-2.0, Math.min(2.0, Number(rawOffset) || 0));
    const rounded = Math.round(clamped * 100) / 100;
    const db = sqliteManager.getDatabase();
    db.prepare('UPDATE tracks SET lyrics_offset = ? WHERE id = ?').run(rounded, trackId);
    return { offset: rounded };
  }

  /**
   * Allows the user to manually paste an ISRC or lrc.red link (e.g. https://lrc.red/s/{ISRC}.ttml),
   * saves the extracted ISRC to the track in SQLite, and fetches/caches its lyrics.
   */
  public async saveTrackIsrcAndFetch(trackId: number, isrcOrUrl: string): Promise<LyricsResult> {
    const extracted = extractIsrcFromInput(isrcOrUrl);
    const db = sqliteManager.getDatabase();

    if (!extracted) {
      const current = await this.getLyrics(trackId, false);
      return {
        ...current,
        error: 'Could not extract a valid ISRC code or lrc.red link. Example: USRC17607839 or https://lrc.red/s/USRC17607839',
      };
    }

    db.prepare('UPDATE tracks SET isrc = ? WHERE id = ?').run(extracted, trackId);
    db.prepare('DELETE FROM lyrics_cache WHERE track_id = ?').run(trackId);

    return this.getLyrics(trackId, true);
  }

  private cacheLyricsInDb(
    trackId: number,
    isrc: string | null,
    format: 'ttml' | 'lrc',
    content: string,
    metadata: Record<string, any> | null,
    source: string
  ): void {
    const db = sqliteManager.getDatabase();
    const metadataJson = metadata ? JSON.stringify(metadata) : null;
    db.prepare(
      `INSERT INTO lyrics_cache (track_id, isrc, format, content, metadata_json, source, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(track_id) DO UPDATE SET
         isrc = excluded.isrc,
         format = excluded.format,
         content = excluded.content,
         metadata_json = excluded.metadata_json,
         source = excluded.source,
         fetched_at = excluded.fetched_at`
    ).run(trackId, isrc, format, content, metadataJson, source, Date.now());
  }

  private saveFallbackCoverArtForTrack(
    trackId: number,
    isrc: string,
    buffer: Buffer,
    ext: '.jpg' | '.webp'
  ): string | null {
    try {
      const hash = crypto.createHash('md5').update(buffer).digest('hex');
      const fileName = `lrc_red_${isrc}_${hash}${ext}`;
      const fullPath = path.join(this.coverCacheDir, fileName);
      if (!fs.existsSync(fullPath)) {
        fs.writeFileSync(fullPath, buffer);
      }
      const db = sqliteManager.getDatabase();
      db.prepare('UPDATE tracks SET cover_art_path = ? WHERE id = ?').run(fileName, trackId);
      return `/api/media/cover/${fileName}`;
    } catch {
      return null;
    }
  }

  private isOnlineLyricsEnabled(): boolean {
    try {
      const db = sqliteManager.getDatabase();
      const row = db
        .prepare<{ value: string }>('SELECT value FROM settings WHERE key = ?')
        .get('player_state');
      if (!row?.value) return true;
      const parsed = JSON.parse(row.value);
      return parsed.lyricsOnlineEnabled !== false;
    } catch {
      return true;
    }
  }

  public getCacheStats(): LyricsCacheStats {
    try {
      const db = sqliteManager.getDatabase();
      const rows = db
        .prepare<{ content: string; metadata_json: string | null }>(
          'SELECT content, metadata_json FROM lyrics_cache'
        )
        .all();
      let totalBytes = 0;
      for (const r of rows) {
        totalBytes += Buffer.byteLength(r.content || '', 'utf-8');
        if (r.metadata_json) {
          totalBytes += Buffer.byteLength(r.metadata_json, 'utf-8');
        }
      }
      return {
        entryCount: rows.length,
        totalBytes,
      };
    } catch {
      return { entryCount: 0, totalBytes: 0 };
    }
  }

  public clearCache(): LyricsCacheStats {
    try {
      const db = sqliteManager.getDatabase();
      db.prepare('DELETE FROM lyrics_cache').run();
    } catch {
      // ignore error
    }
    return this.getCacheStats();
  }
}

export const lyricsService = new LyricsService();
