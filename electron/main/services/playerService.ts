import fs from 'fs';
import path from 'path';
import { sqliteManager } from '../db/sqlite.ts';
import { libraryService } from './libraryService.ts';
import { ffmpegService } from './ffmpegService.ts';
import type {
  ListeningStats,
  PersistedPlayerState,
  StatsAlbumEntry,
  StatsArtistEntry,
  StatsTrackEntry,
  Track,
} from '../../../src/shared/ipcTypes.ts';

const DEFAULT_PLAYER_STATE: PersistedPlayerState = {
  volume: 0.85,
  muted: false,
  shuffle: false,
  repeatMode: 'off',
  currentTrackId: null,
  currentTrackPositionSeconds: 0,
  playNextTrackIds: [],
  queueTrackIds: [],
  outputDeviceId: 'default',
  equalizer: {
    enabled: true,
    preset: 'Flat',
    preamp: 0,
    bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  canvasEnabled: true,
  normalizeVolume: false,
  crossfadeSeconds: 0,
  gaplessPlayback: true,
  themeMode: 'liquid-dark',
  accentMode: 'dynamic',
  customAccentHex: '#818CF8',
  fontScale: 1,
  boldText: false,
  lyricsOnlineEnabled: true,
  lyricsFontSize: 'standard',
  lyricsShowBackgroundVocals: true,
  autoUpdateEnabled: true,
};

const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg; codecs=opus',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
};

export class PlayerService {
  public getPlayerState(): PersistedPlayerState {
    const db = sqliteManager.getDatabase();
    const row = db
      .prepare<{ value: string }>('SELECT value FROM settings WHERE key = ?')
      .get('player_state');

    if (!row?.value) {
      return { ...DEFAULT_PLAYER_STATE };
    }

    try {
      const parsed = JSON.parse(row.value);
      return {
        ...DEFAULT_PLAYER_STATE,
        ...parsed,
        equalizer: {
          ...DEFAULT_PLAYER_STATE.equalizer,
          ...(parsed.equalizer || {}),
          bands:
            Array.isArray(parsed.equalizer?.bands) && parsed.equalizer.bands.length === 10
              ? parsed.equalizer.bands
              : [...DEFAULT_PLAYER_STATE.equalizer.bands],
        },
      };
    } catch {
      return { ...DEFAULT_PLAYER_STATE };
    }
  }

  public savePlayerState(partial: Partial<PersistedPlayerState>): PersistedPlayerState {
    const current = this.getPlayerState();
    const updated: PersistedPlayerState = {
      ...current,
      ...partial,
      equalizer: partial.equalizer
        ? {
            ...current.equalizer,
            ...partial.equalizer,
          }
        : current.equalizer,
    };

    const db = sqliteManager.getDatabase();
    db.prepare(`
      INSERT INTO settings (key, value)
      VALUES ('player_state', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(updated));

    return updated;
  }

  /**
   * Records a track as just-started-playing in the listening history.
   * Collapses rapid repeats (same track started again within 10s, e.g. a seek-triggered
   * reload) into a single entry instead of spamming history.
   */
  public addHistoryEntry(trackId: number): void {
    if (!Number.isFinite(trackId)) return;
    const db = sqliteManager.getDatabase();
    const now = Date.now();

    const last = db
      .prepare<{ track_id: number; played_at: number }>(
        'SELECT track_id, played_at FROM play_history ORDER BY played_at DESC LIMIT 1'
      )
      .get();

    if (last && last.track_id === trackId && now - last.played_at < 10_000) {
      return;
    }

    db.prepare('INSERT INTO play_history (track_id, played_at) VALUES (?, ?)').run(
      trackId,
      now
    );

    // Lifetime stats (kept even when history rows are trimmed or cleared)
    db.prepare(`
      INSERT INTO track_stats (track_id, play_count, total_listen_seconds, first_played_at, last_played_at)
      VALUES (?, 1, 0, ?, ?)
      ON CONFLICT(track_id) DO UPDATE SET
        play_count = play_count + 1,
        last_played_at = excluded.last_played_at
    `).run(trackId, now, now);

    // Keep the history table bounded.
    db.prepare(`
      DELETE FROM play_history
      WHERE id NOT IN (SELECT id FROM play_history ORDER BY played_at DESC LIMIT 500)
    `).run();
  }

  /**
   * Returns recently played tracks, most recent first, each paired with when it was played.
   */
  public getHistory(limit = 100): { track: Track; playedAt: number }[] {
    const db = sqliteManager.getDatabase();
    const rows = db
      .prepare<{ track_id: number; played_at: number }>(
        'SELECT track_id, played_at FROM play_history ORDER BY played_at DESC LIMIT ?'
      )
      .all(Math.max(1, Math.min(500, limit)));

    const results: { track: Track; playedAt: number }[] = [];
    for (const row of rows) {
      const track = libraryService.getTrackById(row.track_id);
      if (track) {
        results.push({ track, playedAt: row.played_at });
      }
    }
    return results;
  }

  /** Adds real listened time (seconds actually played) to a track's lifetime stats. */
  public addListenedSeconds(trackId: number, seconds: number): void {
    if (!Number.isFinite(trackId) || !Number.isFinite(seconds) || seconds <= 0) return;
    const capped = Math.min(seconds, 3600);
    const db = sqliteManager.getDatabase();
    const now = Date.now();
    db.prepare(`
      INSERT INTO track_stats (track_id, play_count, total_listen_seconds, first_played_at, last_played_at)
      VALUES (?, 0, ?, ?, ?)
      ON CONFLICT(track_id) DO UPDATE SET
        total_listen_seconds = total_listen_seconds + excluded.total_listen_seconds,
        last_played_at = excluded.last_played_at
    `).run(trackId, capped, now, now);
  }

  public resetListeningStats(): void {
    sqliteManager.getDatabase().prepare('DELETE FROM track_stats').run();
  }

  public getListeningStats(): ListeningStats {
    const db = sqliteManager.getDatabase();

    const totals = db
      .prepare<{ plays: number; seconds: number; tracks: number; first: number | null }>(
        `SELECT COALESCE(SUM(play_count), 0) AS plays,
                COALESCE(SUM(total_listen_seconds), 0) AS seconds,
                COUNT(*) AS tracks,
                MIN(first_played_at) AS first
         FROM track_stats`
      )
      .get();

    const artistCount = db
      .prepare<{ n: number }>(
        `SELECT COUNT(DISTINCT t.artist) AS n
         FROM track_stats s JOIN tracks t ON t.id = s.track_id`
      )
      .get();

    const topTrackRows = db
      .prepare<{ track_id: number; play_count: number; total_listen_seconds: number }>(
        `SELECT track_id, play_count, total_listen_seconds
         FROM track_stats
         ORDER BY play_count DESC, total_listen_seconds DESC
         LIMIT 10`
      )
      .all();
    const topTracks: StatsTrackEntry[] = [];
    for (const row of topTrackRows) {
      const track = libraryService.getTrackById(row.track_id);
      if (track) {
        topTracks.push({
          track,
          playCount: Number(row.play_count),
          listenSeconds: Number(row.total_listen_seconds),
        });
      }
    }

    const topArtists: StatsArtistEntry[] = db
      .prepare<any>(
        `SELECT t.artist AS artist, MAX(t.cover_art_path) AS cover,
                SUM(s.play_count) AS plays, SUM(s.total_listen_seconds) AS seconds, COUNT(*) AS tracks
         FROM track_stats s JOIN tracks t ON t.id = s.track_id
         GROUP BY t.artist
         ORDER BY plays DESC, seconds DESC
         LIMIT 10`
      )
      .all()
      .map((r: any) => ({
        artist: r.artist,
        coverArtUrl: r.cover ?? null,
        playCount: Number(r.plays),
        listenSeconds: Number(r.seconds),
        trackCount: Number(r.tracks),
      }));

    const topAlbums: StatsAlbumEntry[] = db
      .prepare<any>(
        `SELECT t.album AS album, t.artist AS artist, MAX(t.cover_art_path) AS cover,
                SUM(s.play_count) AS plays, SUM(s.total_listen_seconds) AS seconds
         FROM track_stats s JOIN tracks t ON t.id = s.track_id
         GROUP BY t.album, t.artist
         ORDER BY plays DESC, seconds DESC
         LIMIT 6`
      )
      .all()
      .map((r: any) => ({
        album: r.album,
        artist: r.artist,
        coverArtUrl: r.cover ?? null,
        playCount: Number(r.plays),
        listenSeconds: Number(r.seconds),
      }));

    // Plays per day, last 7 days (local time), from the history log
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6);
    const dayRows = db
      .prepare<{ d: string; c: number }>(
        `SELECT strftime('%Y-%m-%d', played_at / 1000, 'unixepoch', 'localtime') AS d, COUNT(*) AS c
         FROM play_history WHERE played_at >= ? GROUP BY d`
      )
      .all(start.getTime());
    const byDay = new Map(dayRows.map((r) => [r.d, Number(r.c)]));
    const last7Days: { date: string; plays: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(
        day.getDate()
      ).padStart(2, '0')}`;
      last7Days.push({ date: key, plays: byDay.get(key) ?? 0 });
    }

    return {
      totalPlays: Number(totals?.plays ?? 0),
      totalListenSeconds: Number(totals?.seconds ?? 0),
      uniqueTracks: Number(totals?.tracks ?? 0),
      uniqueArtists: Number(artistCount?.n ?? 0),
      firstPlayedAt: totals?.first ?? null,
      topTracks,
      topArtists,
      topAlbums,
      last7Days,
    };
  }

  public clearHistory(): void {
    const db = sqliteManager.getDatabase();
    db.prepare('DELETE FROM play_history').run();
  }

  /**
   * Resolves a track ID to an actual playable audio file on disk.
   * - If a transcoded FLAC/WAV exists in the FFmpeg cache, serves that cached file and updates LRU access time.
   */
  public resolveAudioFileForTrack(
    trackId: number,
    preferTranscoded = false
  ): { filePath: string; mimeType: string; stat: fs.Stats } | null {
    const track = libraryService.getTrackById(trackId);
    if (!track) return null;

    // 1. Check if a transcoded FLAC/WAV file is ready in the FFmpeg LRU cache
    const cachedTranscode = ffmpegService.getCachedTranscodePath(trackId);
    if (
      cachedTranscode &&
      (preferTranscoded || ffmpegService.requiresTranscoding(track.filePath, track.format, track.codec))
    ) {
      return {
        filePath: cachedTranscode.filePath,
        mimeType: cachedTranscode.mimeType,
        stat: cachedTranscode.stat,
      };
    }

    const targetPath = track.filePath;
    if (!fs.existsSync(targetPath)) return null;

    const stat = fs.statSync(targetPath);
    const ext = path.extname(targetPath).toLowerCase();
    const mimeType = MIME_BY_EXT[ext] || 'audio/wav';

    return { filePath: targetPath, mimeType, stat };
  }
}

export const playerService = new PlayerService();
