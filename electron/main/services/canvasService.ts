import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { sqliteManager } from '../db/sqlite.ts';
import { playerService } from './playerService.ts';
import {
  extractSpotifyTrackId,
  getCanvasRemoteProvider,
  resolveSpotifyTrackIdAutomatically,
} from './spotifyCanvasProvider.ts';
import type { CanvasCacheStats, CanvasResult } from '../../../src/shared/ipcTypes.ts';
import { getDataDir } from '../dataDir.ts';

const MAX_CANVAS_CACHE_BYTES = 150 * 1024 * 1024; // 150 MB disk cap for cached Canvas .mp4 videos

interface TrackCanvasRow {
  id: number;
  title: string;
  artist: string;
  album: string;
  isrc: string | null;
  spotify_track_id: string | null;
}

interface CanvasCacheRow {
  spotify_track_id: string;
  track_uri: string | null;
  canvas_id: string | null;
  remote_canvas_url: string | null;
  local_file_name: string | null;
  artist_name: string | null;
  artist_uri: string | null;
  artist_img_url: string | null;
  file_size: number;
  fetched_at: number;
  last_accessed_at: number;
}

export class CanvasService {
  private canvasCacheDir: string;

  constructor() {
    this.canvasCacheDir = path.join(getDataDir(), 'cache', 'canvases');
    if (!fs.existsSync(this.canvasCacheDir)) {
      fs.mkdirSync(this.canvasCacheDir, { recursive: true });
    }
  }

  public getCanvasCacheDir(): string {
    return this.canvasCacheDir;
  }

  public isCanvasEnabled(): boolean {
    const state = playerService.getPlayerState();
    return state.canvasEnabled !== false;
  }

  /**
   * Legacy helper returning just the URL string or null.
   */
  public async getCanvasUrl(trackId: number): Promise<string | null> {
    const res = await this.getCanvasForTrack(trackId, false);
    return res.canvasUrl;
  }

  /**
   * Main entry point to resolve, fetch, and disk-cache a Spotify Canvas video for a track.
   * Never throws; returns `canvasUrl: null` on any miss or network error so the UI
   * falls back cleanly to the blurred, slowly moving album art background.
   */
  public async getCanvasForTrack(trackId: number, forceRefresh = false): Promise<CanvasResult> {
    const emptyResult: CanvasResult = {
      trackId,
      spotifyTrackId: null,
      trackUri: null,
      canvasUrl: null,
      source: 'none',
    };

    try {
      if (!this.isCanvasEnabled()) {
        return emptyResult;
      }

      const db = sqliteManager.getDatabase();
      const track = db
        .prepare<TrackCanvasRow>(
          'SELECT id, title, artist, album, isrc, spotify_track_id FROM tracks WHERE id = ?'
        )
        .get(trackId);

      if (!track) {
        return emptyResult;
      }

      let spotifyTrackId = extractSpotifyTrackId(track.spotify_track_id);

      // Attempt automatic mapping if track doesn't have a Spotify Track ID yet
      if (!spotifyTrackId) {
        const lyricsMetaRow = db
          .prepare<{ metadata_json: string | null }>(
            'SELECT metadata_json FROM lyrics_cache WHERE track_id = ?'
          )
          .get(track.id);

        const autoResolved = await resolveSpotifyTrackIdAutomatically({
          isrc: track.isrc,
          title: track.title,
          artist: track.artist,
          cachedLyricsMetadataJson: lyricsMetaRow?.metadata_json,
        });

        if (autoResolved) {
          spotifyTrackId = autoResolved;
          db.prepare('UPDATE tracks SET spotify_track_id = ? WHERE id = ?').run(
            spotifyTrackId,
            track.id
          );
        }
      }

      if (!spotifyTrackId) {
        return emptyResult;
      }

      const trackUri = `spotify:track:${spotifyTrackId}`;

      // 1. Check SQLite + local disk cache first
      if (!forceRefresh) {
        const cached = db
          .prepare<CanvasCacheRow>('SELECT * FROM canvas_cache WHERE spotify_track_id = ?')
          .get(spotifyTrackId);

        if (cached) {
          const now = Date.now();
          db.prepare('UPDATE canvas_cache SET last_accessed_at = ? WHERE spotify_track_id = ?').run(
            now,
            spotifyTrackId
          );

          if (cached.local_file_name) {
            const localPath = path.join(this.canvasCacheDir, cached.local_file_name);
            if (fs.existsSync(localPath)) {
              return {
                trackId: track.id,
                spotifyTrackId,
                trackUri: cached.track_uri || trackUri,
                canvasUrl: `/api/media/canvas/${cached.local_file_name}`,
                source: 'disk-cache',
                artistName: cached.artist_name,
                artistImgUrl: cached.artist_img_url,
              };
            }
          }

          if (cached.remote_canvas_url) {
            return {
              trackId: track.id,
              spotifyTrackId,
              trackUri: cached.track_uri || trackUri,
              canvasUrl: cached.remote_canvas_url,
              source: 'disk-cache',
              artistName: cached.artist_name,
              artistImgUrl: cached.artist_img_url,
            };
          }

          // Negative cache entry (checked within last 15 minutes and had no canvas)
          if (now - cached.fetched_at < 15 * 60 * 1000) {
            return {
              trackId: track.id,
              spotifyTrackId,
              trackUri,
              canvasUrl: null,
              source: 'none',
            };
          }
        }
      }

      // 2. Fetch from swappable Spotify-Canva provider in main process
      const provider = getCanvasRemoteProvider();
      const remoteItem = await provider.fetchCanvas(spotifyTrackId);

      if (!remoteItem || !remoteItem.canvasUrl) {
        // Record negative lookup in cache so we don't spam the API
        const now = Date.now();
        db.prepare(
          `INSERT INTO canvas_cache (
            spotify_track_id, track_uri, canvas_id, remote_canvas_url, local_file_name,
            artist_name, artist_uri, artist_img_url, file_size, fetched_at, last_accessed_at
          ) VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, NULL, 0, ?, ?)
          ON CONFLICT(spotify_track_id) DO UPDATE SET
            fetched_at = excluded.fetched_at,
            last_accessed_at = excluded.last_accessed_at`
        ).run(spotifyTrackId, trackUri, now, now);

        return {
          trackId: track.id,
          spotifyTrackId,
          trackUri,
          canvasUrl: null,
          source: 'none',
        };
      }

      // 3. Download video file to disk cache and enforce size cap
      const videoBuf = await provider.downloadVideo(remoteItem.canvasUrl);
      let localFileName: string | null = null;
      let fileSize = 0;

      if (videoBuf && videoBuf.length > 0) {
        const hash = crypto
          .createHash('md5')
          .update(`${spotifyTrackId}_${remoteItem.id || ''}`)
          .digest('hex');
        localFileName = `canvas_${spotifyTrackId}_${hash}.mp4`;
        const fullPath = path.join(this.canvasCacheDir, localFileName);
        try {
          fs.writeFileSync(fullPath, videoBuf);
          fileSize = videoBuf.length;
        } catch {
          localFileName = null;
          fileSize = 0;
        }
      }

      const now = Date.now();
      db.prepare(
        `INSERT INTO canvas_cache (
          spotify_track_id, track_uri, canvas_id, remote_canvas_url, local_file_name,
          artist_name, artist_uri, artist_img_url, file_size, fetched_at, last_accessed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(spotify_track_id) DO UPDATE SET
          track_uri = excluded.track_uri,
          canvas_id = excluded.canvas_id,
          remote_canvas_url = excluded.remote_canvas_url,
          local_file_name = COALESCE(excluded.local_file_name, canvas_cache.local_file_name),
          artist_name = excluded.artist_name,
          artist_uri = excluded.artist_uri,
          artist_img_url = excluded.artist_img_url,
          file_size = CASE WHEN excluded.file_size > 0 THEN excluded.file_size ELSE canvas_cache.file_size END,
          fetched_at = excluded.fetched_at,
          last_accessed_at = excluded.last_accessed_at`
      ).run(
        spotifyTrackId,
        remoteItem.trackUri || trackUri,
        remoteItem.id || null,
        remoteItem.canvasUrl,
        localFileName,
        remoteItem.artist?.artistName || null,
        remoteItem.artist?.artistUri || null,
        remoteItem.artist?.artistImgUrl || null,
        fileSize,
        now,
        now
      );

      if (fileSize > 0) {
        this.enforceDiskCacheCap();
      }

      return {
        trackId: track.id,
        spotifyTrackId,
        trackUri: remoteItem.trackUri || trackUri,
        canvasUrl: localFileName ? `/api/media/canvas/${localFileName}` : remoteItem.canvasUrl,
        source: localFileName ? 'disk-cache' : 'spotify-canva',
        artistName: remoteItem.artist?.artistName || null,
        artistImgUrl: remoteItem.artist?.artistImgUrl || null,
      };
    } catch {
      return emptyResult;
    }
  }

  /**
   * Manually links a Spotify Track ID, Spotify URI, or open.spotify.com URL to a track,
   * persists it in SQLite, and immediately fetches/caches the Canvas.
   */
  public async linkSpotifyTrackForCanvas(
    trackId: number,
    rawInput: string
  ): Promise<CanvasResult> {
    const db = sqliteManager.getDatabase();
    const trimmed = rawInput.trim();

    if (!trimmed) {
      db.prepare('UPDATE tracks SET spotify_track_id = NULL WHERE id = ?').run(trackId);
      return {
        trackId,
        spotifyTrackId: null,
        trackUri: null,
        canvasUrl: null,
        source: 'none',
      };
    }

    const spotifyTrackId = extractSpotifyTrackId(trimmed);
    if (!spotifyTrackId) {
      return {
        trackId,
        spotifyTrackId: null,
        trackUri: null,
        canvasUrl: null,
        source: 'none',
      };
    }

    db.prepare('UPDATE tracks SET spotify_track_id = ? WHERE id = ?').run(spotifyTrackId, trackId);
    return this.getCanvasForTrack(trackId, true);
  }

  /**
   * Enforces the disk size cap on `data/cache/canvases/` using LRU eviction
   * ordered by `last_accessed_at ASC`.
   */
  private enforceDiskCacheCap(): void {
    try {
      const db = sqliteManager.getDatabase();
      const rows = db
        .prepare<CanvasCacheRow>(
          `SELECT * FROM canvas_cache
           WHERE local_file_name IS NOT NULL
           ORDER BY last_accessed_at ASC`
        )
        .all();

      let totalBytes = 0;
      const existingRows: Array<{ row: CanvasCacheRow; fullPath: string; size: number }> = [];

      for (const row of rows) {
        if (!row.local_file_name) continue;
        const fullPath = path.join(this.canvasCacheDir, row.local_file_name);
        if (fs.existsSync(fullPath)) {
          const stat = fs.statSync(fullPath);
          totalBytes += stat.size;
          existingRows.push({ row, fullPath, size: stat.size });
        }
      }

      if (totalBytes <= MAX_CANVAS_CACHE_BYTES) {
        return;
      }

      for (const item of existingRows) {
        if (totalBytes <= MAX_CANVAS_CACHE_BYTES) break;
        try {
          fs.unlinkSync(item.fullPath);
          totalBytes -= item.size;
          db.prepare(
            'UPDATE canvas_cache SET local_file_name = NULL, file_size = 0 WHERE spotify_track_id = ?'
          ).run(item.row.spotify_track_id);
        } catch {
          // ignore file unlink error
        }
      }
    } catch {
      // ignore cap enforcement error
    }
  }

  public getCacheStats(): CanvasCacheStats {
    let fileCount = 0;
    let totalBytes = 0;
    try {
      if (fs.existsSync(this.canvasCacheDir)) {
        const files = fs.readdirSync(this.canvasCacheDir);
        for (const file of files) {
          if (file.endsWith('.mp4') || file.endsWith('.webm')) {
            const stat = fs.statSync(path.join(this.canvasCacheDir, file));
            fileCount++;
            totalBytes += stat.size;
          }
        }
      }
    } catch {
      // ignore
    }

    return {
      enabled: this.isCanvasEnabled(),
      fileCount,
      totalBytes,
      maxBytes: MAX_CANVAS_CACHE_BYTES,
      apiBaseUrl: getCanvasRemoteProvider().getBaseUrl(),
    };
  }

  public clearCache(): CanvasCacheStats {
    try {
      if (fs.existsSync(this.canvasCacheDir)) {
        const files = fs.readdirSync(this.canvasCacheDir);
        for (const file of files) {
          if (file.endsWith('.mp4') || file.endsWith('.webm')) {
            try {
              fs.unlinkSync(path.join(this.canvasCacheDir, file));
            } catch {
              // ignore
            }
          }
        }
      }
      const db = sqliteManager.getDatabase();
      db.prepare('DELETE FROM canvas_cache').run();
    } catch {
      // ignore
    }
    return this.getCacheStats();
  }
}

export const canvasService = new CanvasService();
