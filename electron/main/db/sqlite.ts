import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { getDataDir } from '../dataDir.ts';

const requireModule = createRequire(import.meta.url);

export interface StatementAdapter<T = any> {
  run: (...params: any[]) => { changes: number; lastInsertRowid: number | bigint };
  get: (...params: any[]) => T | undefined;
  all: (...params: any[]) => T[];
}

export interface DatabaseAdapter {
  exec: (sql: string) => void;
  pragma: (pragmaStr: string) => any;
  prepare: <T = any>(sql: string) => StatementAdapter<T>;
  transaction: <F extends (...args: any[]) => any>(fn: F) => F;
  close: () => void;
}

/**
 * Provides a synchronous SQLite database engine using `better-sqlite3` on Windows/Electron
 * with an automatic zero-config fallback to Node.js native `node:sqlite` (`DatabaseSync`)
 * when running in environments without native `node-gyp` binaries.
 */
class SqliteDatabaseManager {
  private db: DatabaseAdapter | null = null;
  private dbPath: string;

  constructor() {
    const dataDir = getDataDir();
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.dbPath = path.join(dataDir, 'aestheticy.sqlite');
  }

  public getDatabase(): DatabaseAdapter {
    if (this.db) {
      return this.db;
    }

    // 1. Try native better-sqlite3 first (standard for Windows desktop Electron build)
    try {
      const BetterSqlite3 = requireModule('better-sqlite3');
      const nativeDb = new BetterSqlite3(this.dbPath);
      nativeDb.pragma('journal_mode = WAL');
      nativeDb.pragma('foreign_keys = ON');
      this.db = nativeDb as DatabaseAdapter;
      this.initSchema();
      return this.db;
    } catch {
      // Fallback to Node 22 built-in synchronous SQLite (`node:sqlite`)
    }

    try {
      const { DatabaseSync } = requireModule('node:sqlite');
      const syncDb = new DatabaseSync(this.dbPath);
      syncDb.exec('PRAGMA journal_mode = WAL;');
      syncDb.exec('PRAGMA foreign_keys = ON;');

      let inTransaction = false;

      const adapter: DatabaseAdapter = {
        exec: (sql: string) => {
          syncDb.exec(sql);
        },
        pragma: (pragmaStr: string) => {
          syncDb.exec(`PRAGMA ${pragmaStr};`);
        },
        prepare: <T = any>(sql: string): StatementAdapter<T> => {
          const stmt = syncDb.prepare(sql);
          return {
            run: (...params: any[]) => {
              const normalized = normalizeParams(params);
              const res = Array.isArray(normalized)
                ? stmt.run(...normalized)
                : stmt.run(normalized);
              return {
                changes: Number(res?.changes ?? 0),
                lastInsertRowid: Number(res?.lastInsertRowid ?? 0),
              };
            },
            get: (...params: any[]) => {
              const normalized = normalizeParams(params);
              const res = Array.isArray(normalized)
                ? stmt.get(...normalized)
                : stmt.get(normalized);
              return (res ?? undefined) as T | undefined;
            },
            all: (...params: any[]) => {
              const normalized = normalizeParams(params);
              const res = Array.isArray(normalized)
                ? stmt.all(...normalized)
                : stmt.all(normalized);
              return (res ?? []) as T[];
            },
          };
        },
        transaction: <F extends (...args: any[]) => any>(fn: F): F => {
          const wrapped = ((...args: any[]) => {
            if (inTransaction) {
              return fn(...args);
            }
            inTransaction = true;
            syncDb.exec('BEGIN IMMEDIATE TRANSACTION;');
            try {
              const result = fn(...args);
              syncDb.exec('COMMIT;');
              return result;
            } catch (err) {
              try {
                syncDb.exec('ROLLBACK;');
              } catch {
                // ignore rollback error
              }
              throw err;
            } finally {
              inTransaction = false;
            }
          }) as F;
          return wrapped;
        },
        close: () => {
          syncDb.close();
        },
      };

      this.db = adapter;
      this.initSchema();
      return this.db;
    } catch (err) {
      throw new Error(`Failed to initialize SQLite database: ${String(err)}`);
    }
  }

  private initSchema(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        is_watching INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL UNIQUE,
        folder_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT NOT NULL,
        track_number INTEGER,
        year INTEGER,
        duration REAL NOT NULL DEFAULT 0,
        cover_art_path TEXT,
        isrc TEXT,
        spotify_track_id TEXT,
        lyrics_offset REAL NOT NULL DEFAULT 0,
        format TEXT NOT NULL,
        codec TEXT,
        bitrate INTEGER,
        sample_rate INTEGER,
        bit_depth INTEGER,
        is_lossless INTEGER NOT NULL DEFAULT 0,
        loudness_gain_db REAL,
        chromaprint TEXT,
        unplayable INTEGER NOT NULL DEFAULT 0,
        file_size INTEGER NOT NULL DEFAULT 0,
        modified_at INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_tracks_folder ON tracks(folder_id);
      CREATE INDEX IF NOT EXISTS idx_tracks_isrc ON tracks(isrc);

      CREATE TABLE IF NOT EXISTS transcode_cache (
        track_id INTEGER PRIMARY KEY,
        source_path TEXT NOT NULL,
        cache_file_name TEXT NOT NULL,
        target_format TEXT NOT NULL,
        file_size INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_transcode_lru ON transcode_cache(last_accessed_at ASC);

      CREATE TABLE IF NOT EXISTS lyrics_cache (
        track_id INTEGER PRIMARY KEY,
        isrc TEXT,
        format TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT,
        source TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS canvas_cache (
        spotify_track_id TEXT PRIMARY KEY,
        track_uri TEXT,
        canvas_id TEXT,
        remote_canvas_url TEXT,
        local_file_name TEXT,
        artist_name TEXT,
        artist_uri TEXT,
        artist_img_url TEXT,
        file_size INTEGER NOT NULL DEFAULT 0,
        fetched_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS playlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        is_favorites INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS playlist_tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        playlist_id INTEGER NOT NULL,
        track_id INTEGER NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        added_at INTEGER NOT NULL,
        FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id, position);
      CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON playlist_tracks(track_id);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS play_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id INTEGER NOT NULL,
        played_at INTEGER NOT NULL,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS track_stats (
        track_id INTEGER PRIMARY KEY,
        play_count INTEGER NOT NULL DEFAULT 0,
        total_listen_seconds REAL NOT NULL DEFAULT 0,
        first_played_at INTEGER NOT NULL,
        last_played_at INTEGER NOT NULL,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_track_stats_plays ON track_stats(play_count DESC);
      CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at DESC);
      CREATE INDEX IF NOT EXISTS idx_play_history_track ON play_history(track_id);
    `);

    // Safe migrations for existing databases
    const safeAlterColumns = [
      'ALTER TABLE tracks ADD COLUMN lyrics_offset REAL NOT NULL DEFAULT 0;',
      'ALTER TABLE tracks ADD COLUMN spotify_track_id TEXT;',
      'ALTER TABLE tracks ADD COLUMN codec TEXT;',
      'ALTER TABLE tracks ADD COLUMN bitrate INTEGER;',
      'ALTER TABLE tracks ADD COLUMN sample_rate INTEGER;',
      'ALTER TABLE tracks ADD COLUMN bit_depth INTEGER;',
      'ALTER TABLE tracks ADD COLUMN is_lossless INTEGER NOT NULL DEFAULT 0;',
      'ALTER TABLE tracks ADD COLUMN loudness_gain_db REAL;',
      'ALTER TABLE tracks ADD COLUMN chromaprint TEXT;',
      'ALTER TABLE tracks ADD COLUMN unplayable INTEGER NOT NULL DEFAULT 0;',
    ];

    for (const stmt of safeAlterColumns) {
      try {
        this.db.exec(stmt);
      } catch {
        // Column already exists
      }
    }

    // Ensure the permanent Favorites playlist exists
    const favRow = this.db
      .prepare<{ id: number }>('SELECT id FROM playlists WHERE is_favorites = 1 LIMIT 1')
      .get();
    if (!favRow) {
      const now = Date.now();
      this.db
        .prepare(
          'INSERT INTO playlists (name, description, is_favorites, created_at, updated_at) VALUES (?, ?, 1, ?, ?)'
        )
        .run('Favorites', 'Your liked and starred tracks', now, now);
    }
  }
}

function normalizeParams(params: any[]): any {
  if (
    params.length === 1 &&
    params[0] !== null &&
    typeof params[0] === 'object' &&
    !Array.isArray(params[0]) &&
    !Buffer.isBuffer(params[0])
  ) {
    const obj = params[0];
    const prefixed: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      const cleanKey = k.replace(/^[:@$]/, '');
      prefixed[`@${cleanKey}`] = v ?? null;
      prefixed[`:${cleanKey}`] = v ?? null;
      prefixed[`$${cleanKey}`] = v ?? null;
      prefixed[cleanKey] = v ?? null;
    }
    return prefixed;
  }
  return params.map((p) => (p === undefined ? null : p));
}

export const sqliteManager = new SqliteDatabaseManager();
