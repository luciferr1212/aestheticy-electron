import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import chokidar, { type FSWatcher } from 'chokidar';
import { parseFile } from 'music-metadata';
import { sqliteManager } from '../db/sqlite.ts';
import { ffmpegService } from './ffmpegService.ts';
import type {
  Track,
  AlbumSummary,
  ArtistSummary,
  MusicFolder,
  LibraryStats,
  LibraryEventPayload,
  Playlist,
  CoverCacheStats,
  TrackAudioInfo,
} from '../../../src/shared/ipcTypes.ts';
import { getDataDir } from '../dataDir.ts';

const SUPPORTED_EXTENSIONS = new Set([
  '.mp3',
  '.flac',
  '.wav',
  '.ogg',
  '.opus',
  '.m4a',
  '.aac',
  '.alac',
  '.wma',
  '.ape',
  '.wv',
  '.aiff',
  '.aif',
  '.dsf',
  '.dff',
]);

export class LibraryService extends EventEmitter {
  private watchers = new Map<number, FSWatcher>();
  private coverCacheDir: string;
  private initialized = false;
  private activeScanCount = 0;

  constructor() {
    super();
    this.coverCacheDir = path.join(getDataDir(), 'cache', 'covers');
    if (!fs.existsSync(this.coverCacheDir)) {
      fs.mkdirSync(this.coverCacheDir, { recursive: true });
    }
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    this.purgeLegacyDemoData();

    const existingFolders = this.getFolders();
    for (const folder of existingFolders) {
      if (fs.existsSync(folder.path)) {
        await this.scanFolder(folder.id, folder.path);
        this.startWatchingFolder(folder.id, folder.path);
      }
    }
  }

  /**
   * Ensures any previously auto-generated sample folders, benchmark tracks,
   * or seeded demo playlists ("Liquid Nocturne") are removed so the library
   * only contains real user-added music.
   */
  private purgeLegacyDemoData(): void {
    const db = sqliteManager.getDatabase();
    const demoFolderNames = ['Studio Masters', 'Ambient Archives', 'Electronic Vault'];
    const baseMusicDir = path.join(getDataDir(), 'music');

    // Remove auto-generated sample directories from disk if present
    for (const name of demoFolderNames) {
      const sampleDir = path.join(baseMusicDir, name);
      if (fs.existsSync(sampleDir)) {
        try {
          fs.rmSync(sampleDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }

    // Remove any benchmark tracks from SQLite
    try {
      db.prepare("DELETE FROM tracks WHERE file_path LIKE 'benchmark://%'").run();
    } catch {
      // ignore
    }

    // Remove legacy demo folders and their tracks from SQLite
    const folders = db
      .prepare<{ id: number; path: string; name: string }>('SELECT id, path, name FROM folders')
      .all();
    for (const f of folders) {
      const isSampleFolder =
        demoFolderNames.includes(f.name) &&
        (f.path.includes(path.join('data', 'music')) || !fs.existsSync(f.path));
      if (isSampleFolder) {
        db.prepare('DELETE FROM playlist_tracks WHERE track_id IN (SELECT id FROM tracks WHERE folder_id = ?)').run(f.id);
        db.prepare('DELETE FROM tracks WHERE folder_id = ?').run(f.id);
        db.prepare('DELETE FROM folders WHERE id = ?').run(f.id);
      }
    }

    // Remove the seeded "Liquid Nocturne" demo playlist if present
    const demoPlaylist = db
      .prepare<{ id: number }>(
        "SELECT id FROM playlists WHERE is_favorites = 0 AND name = 'Liquid Nocturne' AND description = 'Atmospheric synthesis & deep nocturnal textures'"
      )
      .get();
    if (demoPlaylist) {
      db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(demoPlaylist.id);
      db.prepare('DELETE FROM playlists WHERE id = ?').run(demoPlaylist.id);
    }

    // Clean up orphaned playlist_tracks
    db.prepare('DELETE FROM playlist_tracks WHERE track_id NOT IN (SELECT id FROM tracks)').run();
  }

  public getCoverCacheDir(): string {
    return this.coverCacheDir;
  }

  public getAvailableServerFolders(): { name: string; path: string; description: string }[] {
    const baseMusicDir = path.join(getDataDir(), 'music');
    if (!fs.existsSync(baseMusicDir)) return [];
    const results: { name: string; path: string; description: string }[] = [];
    try {
      const entries = fs.readdirSync(baseMusicDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const fullPath = path.join(baseMusicDir, entry.name);
          results.push({
            name: entry.name,
            path: fullPath,
            description: fullPath,
          });
        }
      }
    } catch {
      // ignore
    }
    return results;
  }

  private emitLibraryEvent(payload: LibraryEventPayload): void {
    this.emit('library:event', payload);
  }

  public isSupportedAudioFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return SUPPORTED_EXTENSIONS.has(ext);
  }

  private async walkDirectoryRecursiveAsync(dirPath: string): Promise<string[]> {
    const results: string[] = [];
    if (!fs.existsSync(dirPath)) return results;

    const stack: string[] = [dirPath];
    let visitedCount = 0;
    while (stack.length > 0) {
      const current = stack.pop()!;
      let entries: fs.Dirent[] = [];
      try {
        entries = await fs.promises.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.isFile() && this.isSupportedAudioFile(fullPath)) {
          results.push(fullPath);
        }
        visitedCount++;
        if (visitedCount % 250 === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
    }
    return results.sort();
  }

  private cacheCoverArt(picture: { data: Uint8Array | Buffer; format: string }): string | null {
    try {
      const buf = Buffer.from(picture.data);
      const hash = crypto.createHash('sha1').update(buf).digest('hex');
      let ext = '.jpg';
      const fmt = (picture.format || '').toLowerCase();
      if (fmt.includes('png')) ext = '.png';
      else if (fmt.includes('svg')) ext = '.svg';
      else if (fmt.includes('webp')) ext = '.webp';
      else if (fmt.includes('gif')) ext = '.gif';

      const fileName = `${hash}${ext}`;
      const targetPath = path.join(this.coverCacheDir, fileName);
      if (!fs.existsSync(targetPath)) {
        fs.writeFileSync(targetPath, buf);
      }
      return `/api/media/cover/${fileName}`;
    } catch {
      return null;
    }
  }

  private extractIsrcFromMetadata(metadata: Awaited<ReturnType<typeof parseFile>>): string | null {
    if (metadata.common.isrc && metadata.common.isrc.length > 0) {
      return metadata.common.isrc[0];
    }
    if (metadata.native) {
      for (const tags of Object.values(metadata.native)) {
        for (const tag of tags) {
          const id = tag.id.toUpperCase();
          if ((id === 'TSRC' || id === 'ISRC') && typeof tag.value === 'string' && tag.value.trim()) {
            return tag.value.trim();
          }
        }
      }
    }
    return null;
  }

  public async indexSingleFile(filePath: string, folderId: number): Promise<void> {
    if (!this.isSupportedAudioFile(filePath)) return;
    if (!fs.existsSync(filePath)) return;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }

    const db = sqliteManager.getDatabase();
    const existing = db
      .prepare<{
        id: number;
        modified_at: number;
        bitrate: number | null;
        sample_rate: number | null;
        duration: number;
      }>('SELECT id, modified_at, bitrate, sample_rate, duration FROM tracks WHERE file_path = ?')
      .get(filePath);

    const modifiedMs = Math.floor(stat.mtimeMs);
    if (
      existing &&
      existing.modified_at === modifiedMs &&
      existing.bitrate &&
      existing.sample_rate &&
      existing.duration > 0
    ) {
      return;
    }

    const ext = path.extname(filePath).replace('.', '').toUpperCase() || 'AUDIO';
    const fallbackTitle = path
      .basename(filePath, path.extname(filePath))
      .replace(/^\d+\s*[-.]\s*/, '');

    let title = fallbackTitle;
    let artist = 'Unknown Artist';
    let album = path.basename(path.dirname(filePath)) || 'Unknown Album';
    let trackNumber: number | null = null;
    let year: number | null = null;
    let duration = 0;
    let coverArtPath: string | null = null;
    let isrc: string | null = null;
    let codec: string | null = null;
    let bitrate: number | null = null;
    let sampleRate: number | null = null;
    let bitDepth: number | null = null;
    let isLossless = ffmpegService.isFormatLossless(ext, null);

    try {
      const metadata = await parseFile(filePath, { duration: true, skipCovers: false });
      if (metadata.common.title?.trim()) title = metadata.common.title.trim();
      if (metadata.common.artist?.trim()) artist = metadata.common.artist.trim();
      if (metadata.common.album?.trim()) album = metadata.common.album.trim();
      if (typeof metadata.common.track?.no === 'number') trackNumber = metadata.common.track.no;
      if (typeof metadata.common.year === 'number') year = metadata.common.year;
      if (typeof metadata.format.duration === 'number') duration = metadata.format.duration;
      if (typeof metadata.format.bitrate === 'number' && metadata.format.bitrate > 0) {
        bitrate = Math.round(metadata.format.bitrate / 1000);
      }
      if (typeof metadata.format.sampleRate === 'number' && metadata.format.sampleRate > 0) {
        sampleRate = metadata.format.sampleRate;
      }
      if (typeof metadata.format.bitsPerSample === 'number' && metadata.format.bitsPerSample > 0) {
        bitDepth = metadata.format.bitsPerSample;
      }
      if (typeof metadata.format.codec === 'string' && metadata.format.codec.trim()) {
        codec = metadata.format.codec.trim().toUpperCase();
      }
      if (typeof metadata.format.lossless === 'boolean') {
        isLossless = metadata.format.lossless || isLossless;
      }

      isrc = this.extractIsrcFromMetadata(metadata);

      const pic = metadata.common.picture?.[0];
      if (pic && pic.data) {
        coverArtPath = this.cacheCoverArt(pic);
      }
    } catch {
      // Fallback to ffprobe when music-metadata cannot parse non-standard or exotic headers
    }

    // Use ffprobe as metadata fallback when tag parsing misses duration, bitrate, or sample rate
    if (duration <= 0 || !bitrate || !sampleRate) {
      const probed = await ffmpegService.probeAudioMetadata(filePath);
      if (probed) {
        if (duration <= 0 && probed.duration) duration = probed.duration;
        if (!bitrate && probed.bitrate) bitrate = probed.bitrate;
        if (!sampleRate && probed.sampleRate) sampleRate = probed.sampleRate;
        if (!bitDepth && probed.bitDepth) bitDepth = probed.bitDepth;
        if (!codec && probed.codec) codec = probed.codec;
        if (probed.isLossless) isLossless = true;

        if (title === fallbackTitle && probed.title) title = probed.title;
        if (artist === 'Unknown Artist' && probed.artist) artist = probed.artist;
        if (probed.album) album = probed.album;
        if (trackNumber === null && probed.trackNumber !== undefined) {
          trackNumber = probed.trackNumber;
        }
        if (year === null && probed.year !== undefined) {
          year = probed.year;
        }
        if (!isrc && probed.isrc) {
          isrc = probed.isrc;
        }
      }
    }

    // Estimate bitrate from fileSize and duration if still missing
    if (!bitrate && duration > 0 && stat.size > 0) {
      bitrate = Math.round((stat.size * 8) / duration / 1000);
    }

    // Normalize format label (e.g. M4A containing ALAC -> ALAC)
    let displayFormat = ext === 'AIF' ? 'AIFF' : ext;
    if (codec && codec.includes('ALAC')) {
      displayFormat = 'ALAC';
      isLossless = true;
    }

    // Use ffmpeg to extract embedded cover art when needed
    if (!coverArtPath) {
      coverArtPath = await ffmpegService.extractEmbeddedCoverArt(filePath, this.coverCacheDir);
    }

    // Fallback to sibling album artwork in the same folder/album if available
    if (!coverArtPath && album) {
      const siblingCover = db
        .prepare<{ cover_art_path: string | null }>(
          'SELECT cover_art_path FROM tracks WHERE album = ? AND cover_art_path IS NOT NULL LIMIT 1'
        )
        .get(album);
      if (siblingCover?.cover_art_path) {
        coverArtPath = siblingCover.cover_art_path;
      }
    }

    const isCorruptedOrEmpty = stat.size === 0 || duration <= 0;

    db.prepare(`
      INSERT INTO tracks (
        file_path, folder_id, title, artist, album, track_number, year,
        duration, cover_art_path, isrc, format, codec, bitrate, sample_rate, bit_depth, is_lossless,
        unplayable, file_size, modified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        folder_id = excluded.folder_id,
        title = excluded.title,
        artist = excluded.artist,
        album = excluded.album,
        track_number = excluded.track_number,
        year = excluded.year,
        duration = excluded.duration,
        cover_art_path = COALESCE(excluded.cover_art_path, tracks.cover_art_path),
        isrc = COALESCE(NULLIF(excluded.isrc, ''), tracks.isrc),
        format = excluded.format,
        codec = excluded.codec,
        bitrate = excluded.bitrate,
        sample_rate = excluded.sample_rate,
        bit_depth = excluded.bit_depth,
        is_lossless = excluded.is_lossless,
        unplayable = excluded.unplayable,
        file_size = excluded.file_size,
        modified_at = excluded.modified_at
    `).run(
      filePath,
      folderId,
      title,
      artist,
      album,
      trackNumber,
      year,
      duration,
      coverArtPath,
      isrc,
      displayFormat,
      codec,
      bitrate,
      sampleRate,
      bitDepth,
      isLossless ? 1 : 0,
      isCorruptedOrEmpty ? 1 : 0,
      stat.size,
      modifiedMs
    );
  }

  public removeSingleFile(filePath: string): void {
    const db = sqliteManager.getDatabase();
    const res = db.prepare('DELETE FROM tracks WHERE file_path = ?').run(filePath);
    if (res.changes > 0) {
      this.emitLibraryEvent({
        type: 'file-removed',
        filePath,
        message: `Removed ${path.basename(filePath)}`,
      });
    }
  }

  public async scanFolder(folderId: number, folderPath: string): Promise<void> {
    if (!fs.existsSync(folderPath)) {
      this.emitLibraryEvent({
        type: 'scan-complete',
        folderPath,
        message: `Folder "${path.basename(folderPath)}" could not be found. Check if it was moved or is on an unplugged drive.`,
      });
      return;
    }

    this.activeScanCount++;
    try {
      const audioFiles = await this.walkDirectoryRecursiveAsync(folderPath);
      this.emitLibraryEvent({
        type: 'scan-start',
        folderPath,
        totalCount: audioFiles.length,
        processedCount: 0,
        message: `Scanning ${path.basename(folderPath)} (${audioFiles.length.toLocaleString()} songs)...`,
      });

      const db = sqliteManager.getDatabase();
      const existingRows = db
        .prepare<{ file_path: string }>(
          'SELECT file_path FROM tracks WHERE folder_id = ?'
        )
        .all(folderId);
      const activeSet = new Set(audioFiles);
      for (const row of existingRows) {
        if (!activeSet.has(row.file_path)) {
          db.prepare('DELETE FROM tracks WHERE file_path = ?').run(row.file_path);
        }
      }

      let lastProgressEmitMs = 0;
      for (let i = 0; i < audioFiles.length; i++) {
        await this.indexSingleFile(audioFiles[i], folderId);
        if ((i + 1) % 20 === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        const now = Date.now();
        if (now - lastProgressEmitMs >= 150 || i === audioFiles.length - 1) {
          lastProgressEmitMs = now;
          this.emitLibraryEvent({
            type: 'scan-progress',
            folderPath,
            processedCount: i + 1,
            totalCount: audioFiles.length,
            message: `Indexing ${path.basename(folderPath)}: ${(i + 1).toLocaleString()} / ${audioFiles.length.toLocaleString()} songs`,
          });
        }
      }

      this.emitLibraryEvent({
        type: 'scan-complete',
        folderPath,
        processedCount: audioFiles.length,
        totalCount: audioFiles.length,
        message: `Finished scanning ${path.basename(folderPath)} (${audioFiles.length.toLocaleString()} songs)`,
      });
    } finally {
      this.activeScanCount = Math.max(0, this.activeScanCount - 1);
    }
  }

  private startWatchingFolder(folderId: number, folderPath: string): void {
    if (this.watchers.has(folderId)) {
      return;
    }

    const watcher = chokidar.watch(folderPath, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    watcher.on('add', async (filePath: string) => {
      if (this.isSupportedAudioFile(filePath)) {
        await this.indexSingleFile(filePath, folderId);
        this.emitLibraryEvent({
          type: 'file-added',
          folderPath,
          filePath,
          message: `Added ${path.basename(filePath)}`,
        });
      }
    });

    watcher.on('change', async (filePath: string) => {
      if (this.isSupportedAudioFile(filePath)) {
        await this.indexSingleFile(filePath, folderId);
        this.emitLibraryEvent({
          type: 'file-updated',
          folderPath,
          filePath,
          message: `Updated ${path.basename(filePath)}`,
        });
      }
    });

    watcher.on('unlink', (filePath: string) => {
      if (this.isSupportedAudioFile(filePath)) {
        this.removeSingleFile(filePath);
      }
    });

    this.watchers.set(folderId, watcher);
  }

  public async addFolder(rawPath: string): Promise<{ added: boolean; folder?: MusicFolder; error?: string }> {
    const trimmed = (rawPath || '').trim();
    if (!trimmed) {
      return {
        added: false,
        error: 'Please enter or select a folder path on your computer.',
      };
    }

    const resolvedPath = path.resolve(trimmed);
    if (!fs.existsSync(resolvedPath)) {
      return {
        added: false,
        error: `We couldn't find that folder ("${path.basename(resolvedPath) || resolvedPath}"). Please check that the folder exists and hasn't been moved or renamed.`,
      };
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolvedPath);
    } catch {
      return {
        added: false,
        error: 'We do not have permission to open that folder. Please check your folder permissions and try again.',
      };
    }

    if (!stat.isDirectory()) {
      return {
        added: false,
        error: 'That path points to a file instead of a folder. Please choose a folder containing your music.',
      };
    }

    const db = sqliteManager.getDatabase();
    const folderName = path.basename(resolvedPath) || resolvedPath;
    const now = Date.now();

    db.prepare(`
      INSERT INTO folders (path, name, added_at, is_watching)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(path) DO UPDATE SET is_watching = 1
    `).run(resolvedPath, folderName, now);

    const row = db
      .prepare<{ id: number; path: string; name: string; added_at: number; is_watching: number }>(
        'SELECT id, path, name, added_at, is_watching FROM folders WHERE path = ?'
      )
      .get(resolvedPath);

    if (!row) {
      return {
        added: false,
        error: 'Could not save the music folder to your library. Please try again.',
      };
    }

    await this.scanFolder(row.id, row.path);
    this.startWatchingFolder(row.id, row.path);

    const folders = this.getFolders();
    const updatedFolder = folders.find((f) => f.id === row.id);
    return { added: true, folder: updatedFolder };
  }

  public async removeFolder(folderId: number): Promise<void> {
    const watcher = this.watchers.get(folderId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(folderId);
    }

    const db = sqliteManager.getDatabase();
    db.prepare('DELETE FROM tracks WHERE folder_id = ?').run(folderId);
    db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);

    this.emitLibraryEvent({
      type: 'scan-complete',
      message: 'Removed music folder from library',
    });
  }

  public async rescanAllFolders(): Promise<void> {
    const folders = this.getFolders();
    for (const folder of folders) {
      await this.scanFolder(folder.id, folder.path);
    }
  }

  public getFolders(): MusicFolder[] {
    const db = sqliteManager.getDatabase();
    const rows = db
      .prepare<{
        id: number;
        path: string;
        name: string;
        added_at: number;
        is_watching: number;
        track_count: number;
      }>(`
        SELECT
          f.id,
          f.path,
          f.name,
          f.added_at,
          f.is_watching,
          COUNT(t.id) AS track_count
        FROM folders f
        LEFT JOIN tracks t ON t.folder_id = f.id
        GROUP BY f.id
        ORDER BY f.added_at ASC
      `)
      .all();

    return rows.map((r) => {
      const exists = fs.existsSync(r.path);
      return {
        id: r.id,
        path: r.path,
        name: r.name,
        addedAt: r.added_at,
        trackCount: Number(r.track_count || 0),
        isWatching: exists && Boolean(r.is_watching) && this.watchers.has(r.id),
        exists,
        errorMessage: exists
          ? null
          : "We couldn't find this folder on your computer. It may have been moved, renamed, or is on an unplugged drive.",
      };
    });
  }

  private getFavoriteTrackIdsSet(): Set<number> {
    const db = sqliteManager.getDatabase();
    const favRow = this.getFavoritesPlaylistRow();
    if (!favRow) return new Set();
    const rows = db
      .prepare<{ track_id: number }>('SELECT track_id FROM playlist_tracks WHERE playlist_id = ?')
      .all(favRow.id);
    return new Set(rows.map((r) => Number(r.track_id)));
  }

  public getTracks(search?: string): Track[] {
    const db = sqliteManager.getDatabase();
    const favSet = this.getFavoriteTrackIdsSet();
    const q = search?.trim();

    let rows: any[];
    if (q) {
      const like = `%${q}%`;
      rows = db
        .prepare(`
          SELECT
            id, file_path, folder_id, title, artist, album,
            track_number, year, duration, cover_art_path, isrc, spotify_track_id, COALESCE(lyrics_offset, 0) AS lyrics_offset,
            format, codec, bitrate, sample_rate, bit_depth, is_lossless, loudness_gain_db, chromaprint, unplayable,
            file_size, modified_at
          FROM tracks
          WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? OR isrc LIKE ? OR format LIKE ?
          ORDER BY artist COLLATE NOCASE ASC, album COLLATE NOCASE ASC, COALESCE(track_number, 9999) ASC, title COLLATE NOCASE ASC
        `)
        .all(like, like, like, like, like);
    } else {
      rows = db
        .prepare(`
          SELECT
            id, file_path, folder_id, title, artist, album,
            track_number, year, duration, cover_art_path, isrc, spotify_track_id, COALESCE(lyrics_offset, 0) AS lyrics_offset,
            format, codec, bitrate, sample_rate, bit_depth, is_lossless, loudness_gain_db, chromaprint, unplayable,
            file_size, modified_at
          FROM tracks
          ORDER BY artist COLLATE NOCASE ASC, album COLLATE NOCASE ASC, COALESCE(track_number, 9999) ASC, title COLLATE NOCASE ASC
        `)
        .all();
    }

    return rows.map((r) => this.mapTrackRow(r, favSet));
  }

  /** Deep technical tags for the "Audio Info" panel (re-reads the file, nothing is stored). */
  public async getTrackAudioInfo(trackId: number): Promise<TrackAudioInfo | null> {
    const track = this.getTrackById(trackId);
    if (!track || !fs.existsSync(track.filePath)) return null;
    try {
      const md: any = await parseFile(track.filePath, { duration: true, skipCovers: false });
      const f = md.format || {};
      const c = md.common || {};
      const num = (v: unknown): number | null =>
        typeof v === 'number' && Number.isFinite(v) ? v : null;
      const gain = (v: any): number | null => num(v?.dB);
      return {
        container: f.container ?? null,
        codec: f.codec ?? null,
        codecProfile: f.codecProfile ?? null,
        lossless: typeof f.lossless === 'boolean' ? f.lossless : null,
        sampleRate: num(f.sampleRate),
        bitDepth: num(f.bitsPerSample),
        channels: num(f.numberOfChannels),
        bitrate: num(f.bitrate) ? Math.round((f.bitrate as number) / 1000) : null,
        duration: num(f.duration),
        numberOfSamples: num(f.numberOfSamples),
        encoder: f.tool ?? c.encodersettings ?? c.encodedby ?? null,
        tagTypes: Array.isArray(f.tagTypes) ? f.tagTypes : [],
        genre: Array.isArray(c.genre) ? c.genre : [],
        composer: Array.isArray(c.composer) ? c.composer : [],
        albumArtist: c.albumartist ?? null,
        label: Array.isArray(c.label) ? c.label : [],
        discNo: num(c.disk?.no),
        discOf: num(c.disk?.of),
        trackNo: num(c.track?.no),
        trackOf: num(c.track?.of),
        date: c.date ?? (c.year ? String(c.year) : null),
        replayGain: {
          trackGainDb: gain(c.replaygain_track_gain),
          trackPeak: num(c.replaygain_track_peak?.ratio),
          albumGainDb: gain(c.replaygain_album_gain),
          albumPeak: num(c.replaygain_album_peak?.ratio),
        },
        hasEmbeddedCover: Array.isArray(c.picture) && c.picture.length > 0,
        comment: Array.isArray(c.comment)
          ? (typeof c.comment[0] === 'string' ? c.comment[0] : c.comment[0]?.text) ?? null
          : null,
      };
    } catch {
      return null;
    }
  }

  public getTrackById(trackId: number): Track | null {
    const db = sqliteManager.getDatabase();
    const favSet = this.getFavoriteTrackIdsSet();
    const row = db
      .prepare(`
        SELECT
          id, file_path, folder_id, title, artist, album,
          track_number, year, duration, cover_art_path, isrc, spotify_track_id, COALESCE(lyrics_offset, 0) AS lyrics_offset,
          format, codec, bitrate, sample_rate, bit_depth, is_lossless, loudness_gain_db, chromaprint, unplayable,
          file_size, modified_at
        FROM tracks
        WHERE id = ?
      `)
      .get(trackId);
    return row ? this.mapTrackRow(row, favSet) : null;
  }

  public getTrackByFilePath(filePath: string): Track | null {
    const db = sqliteManager.getDatabase();
    const resolved = path.resolve(filePath);
    const row = db
      .prepare<{ id: number }>('SELECT id FROM tracks WHERE file_path = ? COLLATE NOCASE LIMIT 1')
      .get(resolved);
    return row ? this.getTrackById(row.id) : null;
  }

  /**
   * Used by "Open with Aestheticy" / double-clicking an audio file in Windows:
   * returns the library track for that file, adding the file's folder to the library
   * first if it isn't indexed yet.
   */
  public async ensureFileInLibrary(filePath: string): Promise<Track | null> {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved) || !this.isSupportedAudioFile(resolved)) return null;

    const existing = this.getTrackByFilePath(resolved);
    if (existing) return existing;

    await this.addFolder(path.dirname(resolved));
    return this.getTrackByFilePath(resolved);
  }

  public getAlbums(search?: string): AlbumSummary[] {
    const db = sqliteManager.getDatabase();
    const q = search?.trim();

    let rows: any[];
    if (q) {
      const like = `%${q}%`;
      rows = db
        .prepare(`
          SELECT
            album,
            artist,
            MAX(year) AS year,
            COUNT(id) AS track_count,
            SUM(duration) AS total_duration,
            MAX(cover_art_path) AS cover_art_path
          FROM tracks
          WHERE album LIKE ? OR artist LIKE ? OR title LIKE ?
          GROUP BY album, artist
          ORDER BY album COLLATE NOCASE ASC
        `)
        .all(like, like, like);
    } else {
      rows = db
        .prepare(`
          SELECT
            album,
            artist,
            MAX(year) AS year,
            COUNT(id) AS track_count,
            SUM(duration) AS total_duration,
            MAX(cover_art_path) AS cover_art_path
          FROM tracks
          GROUP BY album, artist
          ORDER BY album COLLATE NOCASE ASC
        `)
        .all();
    }

    return rows.map((r) => ({
      album: r.album,
      artist: r.artist,
      year: r.year ?? null,
      trackCount: Number(r.track_count || 0),
      totalDuration: Number(r.total_duration || 0),
      coverArtUrl: r.cover_art_path ?? null,
    }));
  }

  public getArtists(search?: string): ArtistSummary[] {
    const db = sqliteManager.getDatabase();
    const q = search?.trim();

    let rows: any[];
    if (q) {
      const like = `%${q}%`;
      rows = db
        .prepare(`
          SELECT
            artist,
            COUNT(DISTINCT album) AS album_count,
            COUNT(id) AS track_count,
            SUM(duration) AS total_duration,
            MAX(cover_art_path) AS cover_art_path
          FROM tracks
          WHERE artist LIKE ? OR album LIKE ? OR title LIKE ?
          GROUP BY artist
          ORDER BY artist COLLATE NOCASE ASC
        `)
        .all(like, like, like);
    } else {
      rows = db
        .prepare(`
          SELECT
            artist,
            COUNT(DISTINCT album) AS album_count,
            COUNT(id) AS track_count,
            SUM(duration) AS total_duration,
            MAX(cover_art_path) AS cover_art_path
          FROM tracks
          GROUP BY artist
          ORDER BY artist COLLATE NOCASE ASC
        `)
        .all();
    }

    return rows.map((r) => ({
      artist: r.artist,
      albumCount: Number(r.album_count || 0),
      trackCount: Number(r.track_count || 0),
      totalDuration: Number(r.total_duration || 0),
      coverArtUrl: r.cover_art_path ?? null,
    }));
  }

  public getAlbumTracks(album: string, artist?: string): Track[] {
    const db = sqliteManager.getDatabase();
    const favSet = this.getFavoriteTrackIdsSet();
    const rows = artist
      ? db
          .prepare(`
            SELECT
              id, file_path, folder_id, title, artist, album,
              track_number, year, duration, cover_art_path, isrc, spotify_track_id, COALESCE(lyrics_offset, 0) AS lyrics_offset,
              format, codec, bitrate, sample_rate, bit_depth, is_lossless, loudness_gain_db, chromaprint, unplayable,
              file_size, modified_at
            FROM tracks
            WHERE album = ? AND artist = ?
            ORDER BY COALESCE(track_number, 9999) ASC, title COLLATE NOCASE ASC
          `)
          .all(album, artist)
      : db
          .prepare(`
            SELECT
              id, file_path, folder_id, title, artist, album,
              track_number, year, duration, cover_art_path, isrc, spotify_track_id, COALESCE(lyrics_offset, 0) AS lyrics_offset,
              format, codec, bitrate, sample_rate, bit_depth, is_lossless, loudness_gain_db, chromaprint, unplayable,
              file_size, modified_at
            FROM tracks
            WHERE album = ?
            ORDER BY COALESCE(track_number, 9999) ASC, title COLLATE NOCASE ASC
          `)
          .all(album);

    return rows.map((r) => this.mapTrackRow(r, favSet));
  }

  public getArtistTracks(artist: string): Track[] {
    const db = sqliteManager.getDatabase();
    const favSet = this.getFavoriteTrackIdsSet();
    const rows = db
      .prepare(`
        SELECT
          id, file_path, folder_id, title, artist, album,
          track_number, year, duration, cover_art_path, isrc, spotify_track_id, COALESCE(lyrics_offset, 0) AS lyrics_offset,
          format, codec, bitrate, sample_rate, bit_depth, is_lossless, loudness_gain_db, chromaprint, unplayable,
          file_size, modified_at
        FROM tracks
        WHERE artist = ?
        ORDER BY COALESCE(year, 0) DESC, album COLLATE NOCASE ASC, COALESCE(track_number, 9999) ASC, title COLLATE NOCASE ASC
      `)
      .all(artist);

    return rows.map((r) => this.mapTrackRow(r, favSet));
  }

  // ============================================================================
  // Playlists & Favorites (SQLite)
  // ============================================================================

  private getFavoritesPlaylistRow(): { id: number; name: string } | undefined {
    const db = sqliteManager.getDatabase();
    return db
      .prepare<{ id: number; name: string }>(
        'SELECT id, name FROM playlists WHERE is_favorites = 1 LIMIT 1'
      )
      .get();
  }

  public getPlaylists(): Playlist[] {
    const db = sqliteManager.getDatabase();
    const rows = db
      .prepare<{
        id: number;
        name: string;
        description: string;
        is_favorites: number;
        created_at: number;
        updated_at: number;
        track_count: number;
        total_duration: number;
        cover_art_path: string | null;
      }>(`
        SELECT
          p.id,
          p.name,
          p.description,
          p.is_favorites,
          p.created_at,
          p.updated_at,
          COUNT(pt.id) AS track_count,
          COALESCE(SUM(t.duration), 0) AS total_duration,
          MAX(t.cover_art_path) AS cover_art_path
        FROM playlists p
        LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
        LEFT JOIN tracks t ON t.id = pt.track_id
        GROUP BY p.id
        ORDER BY p.is_favorites DESC, p.created_at ASC
      `)
      .all();

    return rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      description: r.description || '',
      isFavorites: Boolean(r.is_favorites),
      trackCount: Number(r.track_count || 0),
      totalDuration: Number(r.total_duration || 0),
      coverArtUrl: r.cover_art_path ?? null,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    }));
  }

  public getPlaylistTracks(playlistId: number, search?: string): Track[] {
    const db = sqliteManager.getDatabase();
    const favSet = this.getFavoriteTrackIdsSet();
    const q = search?.trim();

    let rows: any[];
    if (q) {
      const like = `%${q}%`;
      rows = db
        .prepare(`
          SELECT
            t.id, t.file_path, t.folder_id, t.title, t.artist, t.album,
            t.track_number, t.year, t.duration, t.cover_art_path, t.isrc, t.spotify_track_id, COALESCE(t.lyrics_offset, 0) AS lyrics_offset,
            t.format, t.codec, t.bitrate, t.sample_rate, t.bit_depth, t.is_lossless, t.loudness_gain_db, t.chromaprint, t.unplayable,
            t.file_size, t.modified_at,
            pt.id AS playlist_entry_id,
            pt.position AS position
          FROM playlist_tracks pt
          INNER JOIN tracks t ON t.id = pt.track_id
          WHERE pt.playlist_id = ?
            AND (t.title LIKE ? OR t.artist LIKE ? OR t.album LIKE ? OR t.isrc LIKE ?)
          ORDER BY pt.position ASC, pt.id ASC
        `)
        .all(playlistId, like, like, like, like);
    } else {
      rows = db
        .prepare(`
          SELECT
            t.id, t.file_path, t.folder_id, t.title, t.artist, t.album,
            t.track_number, t.year, t.duration, t.cover_art_path, t.isrc, t.spotify_track_id, COALESCE(t.lyrics_offset, 0) AS lyrics_offset,
            t.format, t.codec, t.bitrate, t.sample_rate, t.bit_depth, t.is_lossless, t.loudness_gain_db, t.chromaprint, t.unplayable,
            t.file_size, t.modified_at,
            pt.id AS playlist_entry_id,
            pt.position AS position
          FROM playlist_tracks pt
          INNER JOIN tracks t ON t.id = pt.track_id
          WHERE pt.playlist_id = ?
          ORDER BY pt.position ASC, pt.id ASC
        `)
        .all(playlistId);
    }

    return rows.map((r) => ({
      ...this.mapTrackRow(r, favSet),
      playlistEntryId: Number(r.playlist_entry_id),
      position: Number(r.position),
    }));
  }

  public createPlaylist(name: string, description = ''): Playlist {
    const db = sqliteManager.getDatabase();
    const cleanName = name.trim() || 'Untitled Playlist';
    const now = Date.now();

    const res = db
      .prepare(
        'INSERT INTO playlists (name, description, is_favorites, created_at, updated_at) VALUES (?, ?, 0, ?, ?)'
      )
      .run(cleanName, description.trim(), now, now);

    const newId = Number(res.lastInsertRowid);
    this.emitLibraryEvent({
      type: 'playlists-updated',
      message: `Created playlist "${cleanName}"`,
    });

    const all = this.getPlaylists();
    return (
      all.find((p) => p.id === newId) || {
        id: newId,
        name: cleanName,
        description: description.trim(),
        isFavorites: false,
        trackCount: 0,
        totalDuration: 0,
        coverArtUrl: null,
        createdAt: now,
        updatedAt: now,
      }
    );
  }

  public renamePlaylist(playlistId: number, name: string, description?: string): Playlist {
    const db = sqliteManager.getDatabase();
    const cleanName = name.trim() || 'Untitled Playlist';
    const now = Date.now();

    if (description !== undefined) {
      db.prepare(
        'UPDATE playlists SET name = ?, description = ?, updated_at = ? WHERE id = ? AND is_favorites = 0'
      ).run(cleanName, description.trim(), now, playlistId);
    } else {
      db.prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ? AND is_favorites = 0').run(
        cleanName,
        now,
        playlistId
      );
    }

    this.emitLibraryEvent({
      type: 'playlists-updated',
      message: `Renamed playlist to "${cleanName}"`,
    });

    const all = this.getPlaylists();
    return all.find((p) => p.id === playlistId)!;
  }

  public deletePlaylist(playlistId: number): void {
    const db = sqliteManager.getDatabase();
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND EXISTS (SELECT 1 FROM playlists WHERE id = ? AND is_favorites = 0)').run(
      playlistId,
      playlistId
    );
    db.prepare('DELETE FROM playlists WHERE id = ? AND is_favorites = 0').run(playlistId);

    this.emitLibraryEvent({
      type: 'playlists-updated',
      message: 'Deleted playlist',
    });
  }

  public addTrackToPlaylist(playlistId: number, trackId: number): void {
    const db = sqliteManager.getDatabase();
    const maxPosRow = db
      .prepare<{ max_pos: number | null }>(
        'SELECT MAX(position) AS max_pos FROM playlist_tracks WHERE playlist_id = ?'
      )
      .get(playlistId);

    const nextPos = (maxPosRow?.max_pos ?? -1) + 1;
    const now = Date.now();

    db.prepare(
      'INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)'
    ).run(playlistId, trackId, nextPos, now);

    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now, playlistId);

    this.emitLibraryEvent({
      type: 'playlists-updated',
      message: 'Added track to playlist',
    });
  }

  public removeTrackFromPlaylist(playlistId: number, playlistEntryId: number): void {
    const db = sqliteManager.getDatabase();
    db.prepare('DELETE FROM playlist_tracks WHERE id = ? AND playlist_id = ?').run(
      playlistEntryId,
      playlistId
    );

    // Re-normalize positions
    const remaining = db
      .prepare<{ id: number }>(
        'SELECT id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC, id ASC'
      )
      .all(playlistId);

    const updateStmt = db.prepare('UPDATE playlist_tracks SET position = ? WHERE id = ?');
    const reindex = db.transaction(() => {
      for (let i = 0; i < remaining.length; i++) {
        updateStmt.run(i, remaining[i].id);
      }
    });
    reindex();

    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), playlistId);

    this.emitLibraryEvent({
      type: 'playlists-updated',
      message: 'Removed track from playlist',
    });
  }

  public reorderPlaylistTracks(playlistId: number, orderedEntryIds: number[]): void {
    const db = sqliteManager.getDatabase();
    const updateStmt = db.prepare(
      'UPDATE playlist_tracks SET position = ? WHERE id = ? AND playlist_id = ?'
    );

    const runReorder = db.transaction(() => {
      for (let idx = 0; idx < orderedEntryIds.length; idx++) {
        updateStmt.run(idx, orderedEntryIds[idx], playlistId);
      }
    });
    runReorder();

    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), playlistId);

    this.emitLibraryEvent({
      type: 'playlists-updated',
    });
  }

  public toggleFavoriteTrack(trackId: number): { isFavorite: boolean } {
    const db = sqliteManager.getDatabase();
    const favPlaylist = this.getFavoritesPlaylistRow();
    if (!favPlaylist) {
      return { isFavorite: false };
    }

    const existing = db
      .prepare<{ id: number }>(
        'SELECT id FROM playlist_tracks WHERE playlist_id = ? AND track_id = ? LIMIT 1'
      )
      .get(favPlaylist.id, trackId);

    if (existing) {
      db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(
        favPlaylist.id,
        trackId
      );
      this.emitLibraryEvent({
        type: 'playlists-updated',
        message: 'Removed from Favorites',
      });
      return { isFavorite: false };
    } else {
      this.addTrackToPlaylist(favPlaylist.id, trackId);
      return { isFavorite: true };
    }
  }

  public getFavoriteTracks(search?: string): Track[] {
    const favPlaylist = this.getFavoritesPlaylistRow();
    if (!favPlaylist) return [];
    return this.getPlaylistTracks(favPlaylist.id, search);
  }

  public getStats(): LibraryStats {
    const db = sqliteManager.getDatabase();
    const row = db
      .prepare<{
        total_tracks: number;
        total_albums: number;
        total_artists: number;
        total_duration: number;
        unplayable_count: number;
      }>(`
        SELECT
          COUNT(id) AS total_tracks,
          COUNT(DISTINCT album || '::' || artist) AS total_albums,
          COUNT(DISTINCT artist) AS total_artists,
          COALESCE(SUM(duration), 0) AS total_duration,
          SUM(CASE WHEN unplayable = 1 THEN 1 ELSE 0 END) AS unplayable_count
        FROM tracks
      `)
      .get();

    const folders = this.getFolders();
    const missingFoldersCount = folders.filter((f) => f.exists === false).length;
    const playlistRow = db
      .prepare<{ cnt: number }>('SELECT COUNT(id) AS cnt FROM playlists WHERE is_favorites = 0')
      .get();
    const favPlaylist = this.getFavoritesPlaylistRow();
    const favCountRow = favPlaylist
      ? db
          .prepare<{ cnt: number }>(
            'SELECT COUNT(id) AS cnt FROM playlist_tracks WHERE playlist_id = ?'
          )
          .get(favPlaylist.id)
      : { cnt: 0 };

    return {
      totalTracks: Number(row?.total_tracks || 0),
      totalAlbums: Number(row?.total_albums || 0),
      totalArtists: Number(row?.total_artists || 0),
      totalDuration: Number(row?.total_duration || 0),
      totalFolders: folders.length,
      totalPlaylists: Number(playlistRow?.cnt || 0),
      favoriteTracksCount: Number(favCountRow?.cnt || 0),
      unplayableTracksCount: Number(row?.unplayable_count || 0),
      missingFoldersCount,
      isScanning: this.activeScanCount > 0,
    };
  }

  public getCoverCacheStats(): CoverCacheStats {
    try {
      if (!fs.existsSync(this.coverCacheDir)) {
        return { fileCount: 0, totalBytes: 0, cacheDir: this.coverCacheDir };
      }
      const files = fs.readdirSync(this.coverCacheDir);
      let fileCount = 0;
      let totalBytes = 0;
      for (const name of files) {
        const fullPath = path.join(this.coverCacheDir, name);
        try {
          const st = fs.statSync(fullPath);
          if (st.isFile()) {
            fileCount++;
            totalBytes += st.size;
          }
        } catch {
          // ignore
        }
      }
      return { fileCount, totalBytes, cacheDir: this.coverCacheDir };
    } catch {
      return { fileCount: 0, totalBytes: 0, cacheDir: this.coverCacheDir };
    }
  }

  public clearCoverCache(): CoverCacheStats {
    try {
      if (fs.existsSync(this.coverCacheDir)) {
        for (const name of fs.readdirSync(this.coverCacheDir)) {
          try {
            fs.unlinkSync(path.join(this.coverCacheDir, name));
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
    return this.getCoverCacheStats();
  }

  public resetUnplayableTracks(): { resetCount: number } {
    try {
      const db = sqliteManager.getDatabase();
      const res = db.prepare('UPDATE tracks SET unplayable = 0 WHERE unplayable = 1').run();
      this.emitLibraryEvent({
        type: 'scan-complete',
        message: `Reset ${res.changes} damaged/unplayable track status${res.changes === 1 ? '' : 'es'}`,
      });
      return { resetCount: Number(res.changes || 0) };
    } catch {
      return { resetCount: 0 };
    }
  }

  private mapTrackRow(r: any, favSet?: Set<number>): Track {
    const id = Number(r.id);
    const fmt = r.format || 'AUDIO';
    const isLossless =
      r.is_lossless !== undefined && r.is_lossless !== null
        ? Boolean(r.is_lossless)
        : ffmpegService.isFormatLossless(fmt, r.codec);

    return {
      id,
      filePath: r.file_path,
      folderId: Number(r.folder_id),
      title: r.title,
      artist: r.artist,
      album: r.album,
      trackNumber: r.track_number !== null && r.track_number !== undefined ? Number(r.track_number) : null,
      year: r.year !== null && r.year !== undefined ? Number(r.year) : null,
      duration: Number(r.duration || 0),
      coverArtUrl: r.cover_art_path ?? null,
      isrc: r.isrc || null,
      spotifyTrackId: r.spotify_track_id || null,
      lyricsOffset: Number(r.lyrics_offset || 0),
      format: fmt,
      codec: r.codec || null,
      bitrate: r.bitrate ? Number(r.bitrate) : null,
      sampleRate: r.sample_rate ? Number(r.sample_rate) : null,
      bitDepth: r.bit_depth ? Number(r.bit_depth) : null,
      isLossless,
      loudnessGainDb:
        r.loudness_gain_db !== null && r.loudness_gain_db !== undefined
          ? Number(r.loudness_gain_db)
          : null,
      chromaprint: r.chromaprint || null,
      unplayable: Boolean(r.unplayable),
      fileSize: Number(r.file_size || 0),
      modifiedAt: Number(r.modified_at || 0),
      isFavorite: favSet ? favSet.has(id) : false,
    };
  }
}

export const libraryService = new LibraryService();
