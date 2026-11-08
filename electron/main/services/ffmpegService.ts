import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { sqliteManager } from '../db/sqlite.ts';
import type {
  FfmpegStatus,
  TranscodeCacheStats,
  TranscodeResult,
} from '../../../src/shared/ipcTypes.ts';
import { getDataDir } from '../dataDir.ts';

const requireModule = createRequire(import.meta.url);

// 2 GB maximum cache size for transcoded FLAC/WAV files
const MAX_TRANSCODE_CACHE_BYTES = 2 * 1024 * 1024 * 1024;

// Formats that HTML5 <audio> in Chromium cannot reliably decode natively
const NON_NATIVE_EXTENSIONS = new Set([
  '.alac',
  '.wma',
  '.ape',
  '.wv',
  '.aiff',
  '.aif',
  '.dsf',
  '.dff',
]);

const LOSSLESS_EXTENSIONS = new Set([
  '.flac',
  '.wav',
  '.alac',
  '.ape',
  '.wv',
  '.aiff',
  '.aif',
  '.dsf',
  '.dff',
]);

const LOSSLESS_CODECS = new Set([
  'flac',
  'alac',
  'pcm_s16le',
  'pcm_s16be',
  'pcm_s24le',
  'pcm_s24be',
  'pcm_s32le',
  'pcm_s32be',
  'pcm_f32le',
  'pcm_f64le',
  'pcm_u8',
  'ape',
  'wavpack',
  'wv',
  'dsd_lsbf',
  'dsd_msbf',
  'dsd_lsbf_planar',
  'dsd_msbf_planar',
  'wmavoice',
  'wmalossless',
]);

export interface ProbedAudioMetadata {
  duration: number | null;
  bitrate: number | null; // kbps
  sampleRate: number | null; // Hz
  bitDepth: number | null;
  codec: string | null;
  isLossless: boolean;
  title?: string;
  artist?: string;
  album?: string;
  trackNumber?: number;
  year?: number;
  isrc?: string;
}

export class FfmpegService {
  private transcodeCacheDir: string;
  private ffmpegPath: string;
  private ffprobePath: string;
  private cachedVersion: string | null = null;
  private inFlightTranscodes = new Map<number, Promise<TranscodeResult>>();
  private inFlightLoudness = new Map<number, Promise<number>>();

  constructor() {
    this.transcodeCacheDir = path.join(getDataDir(), 'cache', 'transcodes');
    if (!fs.existsSync(this.transcodeCacheDir)) {
      fs.mkdirSync(this.transcodeCacheDir, { recursive: true });
    }

    const resolved = this.resolveBinaries();
    this.ffmpegPath = resolved.ffmpegPath;
    this.ffprobePath = resolved.ffprobePath;
  }

  public getFfmpegPath(): string {
    return this.ffmpegPath;
  }

  /**
   * Resolves bundled ffmpeg & ffprobe binaries via Electron extraResources,
   * ffmpeg-static / ffprobe-static packages, or system PATH fallback.
   */
  private resolveBinaries(): { ffmpegPath: string; ffprobePath: string } {
    const isWin = process.platform === 'win32';
    const ffmpegExe = isWin ? 'ffmpeg.exe' : 'ffmpeg';
    const ffprobeExe = isWin ? 'ffprobe.exe' : 'ffprobe';

    let ffmpegCandidate: string | null = null;
    let ffprobeCandidate: string | null = null;

    // 1. Check Electron packaged extraResources directory
    const resourcesPath = (process as any).resourcesPath;
    if (resourcesPath && typeof resourcesPath === 'string') {
      const resFfmpeg = path.join(resourcesPath, 'bin', ffmpegExe);
      const resFfprobe = path.join(resourcesPath, 'bin', ffprobeExe);
      if (fs.existsSync(resFfmpeg)) ffmpegCandidate = resFfmpeg;
      if (fs.existsSync(resFfprobe)) ffprobeCandidate = resFfprobe;
    }

    // 2. Check system binaries first if executable, or ffmpeg-static / ffprobe-static
    if (!ffmpegCandidate) {
      try {
        const staticFfmpeg = requireModule('ffmpeg-static');
        const resolvedPath =
          typeof staticFfmpeg === 'string' ? staticFfmpeg : staticFfmpeg?.default;
        if (resolvedPath && fs.existsSync(resolvedPath)) {
          ffmpegCandidate = resolvedPath;
        }
      } catch {
        // Fallback to system binary
      }
    }

    if (!ffprobeCandidate) {
      try {
        const staticFfprobe = requireModule('ffprobe-static');
        const resolvedPath =
          typeof staticFfprobe?.path === 'string'
            ? staticFfprobe.path
            : typeof staticFfprobe?.default?.path === 'string'
            ? staticFfprobe.default.path
            : null;
        if (resolvedPath && fs.existsSync(resolvedPath)) {
          ffprobeCandidate = resolvedPath;
        }
      } catch {
        // Fallback to system binary
      }
    }

    // Executables cannot be spawned from inside app.asar: use the asarUnpack'd copy.
    const toUnpacked = (p: string | null): string | null => {
      if (!p) return p;
      const marker = `app.asar${path.sep}`;
      if (!p.includes(marker)) return p;
      const unpacked = p.replace(marker, `app.asar.unpacked${path.sep}`);
      return fs.existsSync(unpacked) ? unpacked : p;
    };
    ffmpegCandidate = toUnpacked(ffmpegCandidate);
    ffprobeCandidate = toUnpacked(ffprobeCandidate);

    if (!ffmpegCandidate) {
      if (fs.existsSync('/usr/bin/ffmpeg')) {
        ffmpegCandidate = '/usr/bin/ffmpeg';
      } else {
        ffmpegCandidate = ffmpegExe;
      }
    }

    if (!ffprobeCandidate) {
      if (fs.existsSync('/usr/bin/ffprobe')) {
        ffprobeCandidate = '/usr/bin/ffprobe';
      } else {
        ffprobeCandidate = ffprobeExe;
      }
    }

    return {
      ffmpegPath: ffmpegCandidate,
      ffprobePath: ffprobeCandidate,
    };
  }

  public getTranscodeCacheDir(): string {
    return this.transcodeCacheDir;
  }

  public isFormatLossless(extOrFormat: string, codec?: string | null): boolean {
    const cleanExt = extOrFormat.startsWith('.')
      ? extOrFormat.toLowerCase()
      : `.${extOrFormat.toLowerCase()}`;
    if (LOSSLESS_EXTENSIONS.has(cleanExt)) return true;
    if (codec && LOSSLESS_CODECS.has(codec.toLowerCase())) return true;
    return false;
  }

  public requiresTranscoding(filePath: string, format?: string, codec?: string | null): boolean {
    const ext = path.extname(filePath).toLowerCase();
    if (NON_NATIVE_EXTENSIONS.has(ext)) return true;
    if (format && NON_NATIVE_EXTENSIONS.has(`.${format.toLowerCase()}`)) return true;
    if (codec) {
      const lowerCodec = codec.toLowerCase();
      if (
        lowerCodec === 'alac' ||
        lowerCodec.includes('wma') ||
        lowerCodec === 'ape' ||
        lowerCodec === 'wavpack' ||
        lowerCodec.startsWith('dsd') ||
        lowerCodec === 'pcm_s24be' ||
        lowerCodec === 'pcm_s16be'
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Executes a binary with child_process.spawn and collects stdout/stderr.
   */
  private runSpawnBuffer(
    binPath: string,
    args: string[],
    timeoutMs = 60000
  ): Promise<{ code: number | null; stdout: Buffer; stderr: string }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      const proc = spawn(binPath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            proc.kill('SIGKILL');
          } catch {
            // ignore
          }
          reject(new Error(`Process timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      proc.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(Buffer.from(chunk));
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(Buffer.from(chunk));
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve({
            code,
            stdout: Buffer.concat(stdoutChunks),
            stderr: Buffer.concat(stderrChunks).toString('utf-8'),
          });
        }
      });
    });
  }

  public async getStatus(): Promise<FfmpegStatus> {
    let available = false;
    let ffprobeAvailable = false;

    try {
      const res = await this.runSpawnBuffer(this.ffmpegPath, ['-version'], 5000);
      if (res.code === 0) {
        available = true;
        const firstLine = res.stdout.toString('utf-8').split('\n')[0]?.trim() || null;
        this.cachedVersion = firstLine;
      }
    } catch {
      // Fallback to system 'ffmpeg' if static binary failed on this architecture
      if (this.ffmpegPath !== '/usr/bin/ffmpeg' && fs.existsSync('/usr/bin/ffmpeg')) {
        this.ffmpegPath = '/usr/bin/ffmpeg';
        try {
          const res = await this.runSpawnBuffer(this.ffmpegPath, ['-version'], 5000);
          if (res.code === 0) {
            available = true;
            this.cachedVersion = res.stdout.toString('utf-8').split('\n')[0]?.trim() || null;
          }
        } catch {
          available = false;
        }
      }
    }

    try {
      const probeRes = await this.runSpawnBuffer(this.ffprobePath, ['-version'], 5000);
      if (probeRes.code === 0) {
        ffprobeAvailable = true;
      }
    } catch {
      if (this.ffprobePath !== '/usr/bin/ffprobe' && fs.existsSync('/usr/bin/ffprobe')) {
        this.ffprobePath = '/usr/bin/ffprobe';
        try {
          const probeRes = await this.runSpawnBuffer(this.ffprobePath, ['-version'], 5000);
          if (probeRes.code === 0) {
            ffprobeAvailable = true;
          }
        } catch {
          ffprobeAvailable = false;
        }
      }
    }

    return {
      available,
      ffprobeAvailable,
      version: this.cachedVersion,
      ffmpegPath: this.ffmpegPath,
      ffprobePath: this.ffprobePath,
      cacheStats: this.getCacheStats(),
    };
  }

  /**
   * Uses ffprobe as a metadata fallback when music-metadata misses duration, bitrate,
   * sample rate, bit depth, or tags.
   */
  public async probeAudioMetadata(filePath: string): Promise<ProbedAudioMetadata | null> {
    if (!fs.existsSync(filePath)) return null;

    const args = [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ];

    let result;
    try {
      result = await this.runSpawnBuffer(this.ffprobePath, args, 15000);
    } catch {
      if (this.ffprobePath !== '/usr/bin/ffprobe' && fs.existsSync('/usr/bin/ffprobe')) {
        this.ffprobePath = '/usr/bin/ffprobe';
        try {
          result = await this.runSpawnBuffer(this.ffprobePath, args, 15000);
        } catch {
          return null;
        }
      } else {
        return null;
      }
    }

    if (!result || result.code !== 0) return null;

    try {
      const parsed = JSON.parse(result.stdout.toString('utf-8'));
      const streams: any[] = Array.isArray(parsed.streams) ? parsed.streams : [];
      const audioStream = streams.find((s) => s.codec_type === 'audio') || streams[0] || {};
      const formatObj = parsed.format || {};

      const rawDur = parseFloat(audioStream.duration || formatObj.duration || '0');
      const duration = Number.isFinite(rawDur) && rawDur > 0 ? rawDur : null;

      const rawBitrate = parseInt(audioStream.bit_rate || formatObj.bit_rate || '0', 10);
      let bitrate =
        Number.isFinite(rawBitrate) && rawBitrate > 0 ? Math.round(rawBitrate / 1000) : null;

      if (!bitrate && duration && formatObj.size) {
        const sizeBytes = parseInt(formatObj.size, 10);
        if (Number.isFinite(sizeBytes) && sizeBytes > 0) {
          bitrate = Math.round((sizeBytes * 8) / duration / 1000);
        }
      }

      const rawSampleRate = parseInt(audioStream.sample_rate || '0', 10);
      const sampleRate =
        Number.isFinite(rawSampleRate) && rawSampleRate > 0 ? rawSampleRate : null;

      const rawBitDepth = parseInt(
        audioStream.bits_per_raw_sample || audioStream.bits_per_sample || '0',
        10
      );
      const bitDepth = Number.isFinite(rawBitDepth) && rawBitDepth > 0 ? rawBitDepth : null;

      const codecName =
        typeof audioStream.codec_name === 'string' ? audioStream.codec_name : null;

      const ext = path.extname(filePath).toLowerCase();
      const isLossless = this.isFormatLossless(ext, codecName);

      // Extract fallback tags from format.tags or stream.tags
      const rawTags = { ...(audioStream.tags || {}), ...(formatObj.tags || {}) };
      const normTags: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawTags)) {
        if (typeof v === 'string' && v.trim()) {
          normTags[k.toLowerCase()] = v.trim();
        }
      }

      const trackStr = normTags.track || normTags.tracknumber;
      const trackNum = trackStr ? parseInt(trackStr.split('/')[0], 10) : undefined;
      const dateStr = normTags.date || normTags.year || normTags.tyer;
      const yearNum = dateStr ? parseInt(dateStr.slice(0, 4), 10) : undefined;

      return {
        duration,
        bitrate,
        sampleRate,
        bitDepth,
        codec: codecName ? codecName.toUpperCase() : null,
        isLossless,
        title: normTags.title,
        artist: normTags.artist || normTags.album_artist,
        album: normTags.album,
        trackNumber: Number.isFinite(trackNum) ? trackNum : undefined,
        year: Number.isFinite(yearNum) ? yearNum : undefined,
        isrc: normTags.isrc || normTags.tsrc,
      };
    } catch {
      return null;
    }
  }

  /**
   * Uses ffmpeg to extract embedded cover art from an audio file when music-metadata
   * cannot extract it.
   */
  public async extractEmbeddedCoverArt(
    filePath: string,
    coverCacheDir: string
  ): Promise<string | null> {
    if (!fs.existsSync(filePath)) return null;

    const args = [
      '-v',
      'error',
      '-i',
      filePath,
      '-an',
      '-vcodec',
      'mjpeg',
      '-frames:v',
      '1',
      '-f',
      'image2pipe',
      '-',
    ];

    try {
      const res = await this.runSpawnBuffer(this.ffmpegPath, args, 15000);
      if (res.code === 0 && res.stdout.length > 128) {
        const hash = crypto.createHash('sha1').update(res.stdout).digest('hex');
        const fileName = `${hash}.jpg`;
        const targetPath = path.join(coverCacheDir, fileName);
        if (!fs.existsSync(targetPath)) {
          fs.writeFileSync(targetPath, res.stdout);
        }
        return `/api/media/cover/${fileName}`;
      }
    } catch {
      // Ignore if no embedded video/image stream exists
    }
    return null;
  }

  /**
   * Generates a real audio file in a specified format (e.g., AIFF, ALAC in M4A, WavPack)
   * from a WAV file using ffmpeg so exotic formats can be tested immediately.
   */
  public async convertWavToFormat(
    sourceWavPath: string,
    destPath: string,
    codecArgs: string[]
  ): Promise<boolean> {
    if (!fs.existsSync(sourceWavPath)) return false;
    try {
      const args = ['-y', '-v', 'error', '-i', sourceWavPath, ...codecArgs, destPath];
      const res = await this.runSpawnBuffer(this.ffmpegPath, args, 20000);
      return res.code === 0 && fs.existsSync(destPath) && fs.statSync(destPath).size > 256;
    } catch {
      return false;
    }
  }

  /**
   * Resolves a cached transcoded file path for a track if it exists on disk,
   * and updates its last_accessed_at timestamp for LRU cache management.
   */
  public getCachedTranscodePath(trackId: number): {
    filePath: string;
    mimeType: string;
    stat: fs.Stats;
    targetFormat: string;
  } | null {
    const db = sqliteManager.getDatabase();
    const row = db
      .prepare<{
        cache_file_name: string;
        target_format: string;
      }>('SELECT cache_file_name, target_format FROM transcode_cache WHERE track_id = ?')
      .get(trackId);

    if (!row) return null;

    const fullPath = path.join(this.transcodeCacheDir, path.basename(row.cache_file_name));
    if (!fs.existsSync(fullPath)) {
      db.prepare('DELETE FROM transcode_cache WHERE track_id = ?').run(trackId);
      return null;
    }

    const stat = fs.statSync(fullPath);
    if (stat.size === 0) {
      try {
        fs.unlinkSync(fullPath);
      } catch {
        // ignore
      }
      db.prepare('DELETE FROM transcode_cache WHERE track_id = ?').run(trackId);
      return null;
    }

    const now = Date.now();
    db.prepare('UPDATE transcode_cache SET last_accessed_at = ? WHERE track_id = ?').run(
      now,
      trackId
    );

    const ext = path.extname(fullPath).toLowerCase();
    const mimeType = ext === '.flac' ? 'audio/flac' : 'audio/wav';

    return {
      filePath: fullPath,
      mimeType,
      stat,
      targetFormat: row.target_format || (ext === '.flac' ? 'FLAC' : 'WAV'),
    };
  }

  /**
   * Prepares a track for playback.
   * - If the track format is natively supported and forceTranscode is false, returns ready immediately.
   * - If the track is in an unsupported format (ALAC, WMA, APE, WV, AIFF, AIF, DSF, DFF) or forceTranscode is true,
   *   transcodes it to a temp FLAC (or WAV fallback) in the 2 GB LRU cache folder.
   * - If decoding fails completely, marks the track as unplayable in SQLite.
   */
  public async prepareTrack(
    trackId: number,
    forceTranscode = false,
    analyzeLoudness = false
  ): Promise<TranscodeResult> {
    const db = sqliteManager.getDatabase();
    const row = db
      .prepare<{
        id: number;
        file_path: string;
        format: string;
        codec: string | null;
        modified_at: number;
        loudness_gain_db: number | null;
        unplayable: number;
      }>(
        'SELECT id, file_path, format, codec, modified_at, loudness_gain_db, unplayable FROM tracks WHERE id = ?'
      )
      .get(trackId);

    if (!row) {
      return {
        status: 'unplayable',
        trackId,
        streamUrl: null,
        transcoded: false,
        error: 'Track not found in library',
      };
    }

    const sourcePath = row.file_path;
    if (!fs.existsSync(sourcePath)) {
      this.markTrackUnplayable(trackId);
      return {
        status: 'unplayable',
        trackId,
        streamUrl: null,
        transcoded: false,
        error: 'Audio file does not exist on disk',
      };
    }

    const needsTranscode =
      forceTranscode || this.requiresTranscoding(sourcePath, row.format, row.codec);

    let loudnessGainDb = row.loudness_gain_db;
    if (analyzeLoudness && (loudnessGainDb === null || loudnessGainDb === undefined)) {
      loudnessGainDb = await this.analyzeTrackLoudness(trackId).catch(() => 0);
    }

    if (!needsTranscode) {
      // Check if we already have a cached transcode from an earlier fallback
      const existingCache = this.getCachedTranscodePath(trackId);
      if (existingCache) {
        return {
          status: 'ready',
          trackId,
          streamUrl: `/api/media/stream/${trackId}?transcoded=1`,
          transcoded: true,
          targetFormat: existingCache.targetFormat,
          loudnessGainDb,
        };
      }

      return {
        status: 'ready',
        trackId,
        streamUrl: `/api/media/stream/${trackId}`,
        transcoded: false,
        loudnessGainDb,
      };
    }

    // Check if already cached in transcode_cache
    const cached = this.getCachedTranscodePath(trackId);
    if (cached) {
      return {
        status: 'ready',
        trackId,
        streamUrl: `/api/media/stream/${trackId}?transcoded=1`,
        transcoded: true,
        targetFormat: cached.targetFormat,
        loudnessGainDb,
      };
    }

    // Deduplicate concurrent transcode requests for the same track (e.g., background pre-transcode + immediate play)
    const existingPromise = this.inFlightTranscodes.get(trackId);
    if (existingPromise) {
      return existingPromise;
    }

    const transcodePromise = this.executeTranscode(trackId, sourcePath, row.modified_at, analyzeLoudness);
    this.inFlightTranscodes.set(trackId, transcodePromise);

    try {
      return await transcodePromise;
    } finally {
      this.inFlightTranscodes.delete(trackId);
    }
  }

  private async executeTranscode(
    trackId: number,
    sourcePath: string,
    modifiedAt: number,
    analyzeLoudness: boolean
  ): Promise<TranscodeResult> {
    const baseKey = `track_${trackId}_${modifiedAt || 0}`;
    const flacFileName = `${baseKey}.flac`;
    const flacFinalPath = path.join(this.transcodeCacheDir, flacFileName);
    const flacTempPath = path.join(this.transcodeCacheDir, `${baseKey}.${process.pid}.tmp.flac`);

    let targetFileName = flacFileName;
    let targetFinalPath = flacFinalPath;
    let targetFormat: 'FLAC' | 'WAV' = 'FLAC';
    let success = false;

    // 1. Try transcoding to lossless FLAC first
    try {
      const flacArgs = [
        '-y',
        '-v',
        'error',
        '-i',
        sourcePath,
        '-vn',
        '-map_metadata',
        '-1',
        '-c:a',
        'flac',
        '-compression_level',
        '5',
        flacTempPath,
      ];

      const res = await this.runSpawnBuffer(this.ffmpegPath, flacArgs, 90000);
      if (res.code === 0 && fs.existsSync(flacTempPath) && fs.statSync(flacTempPath).size > 256) {
        fs.renameSync(flacTempPath, flacFinalPath);
        success = true;
      } else if (fs.existsSync(flacTempPath)) {
        fs.unlinkSync(flacTempPath);
      }
    } catch {
      if (fs.existsSync(flacTempPath)) {
        try {
          fs.unlinkSync(flacTempPath);
        } catch {
          // ignore
        }
      }
    }

    // 2. Fallback to uncompressed 16-bit PCM WAV if FLAC encoder failed (e.g., exotic DSD sample rates)
    if (!success) {
      const wavFileName = `${baseKey}.wav`;
      const wavFinalPath = path.join(this.transcodeCacheDir, wavFileName);
      const wavTempPath = path.join(this.transcodeCacheDir, `${baseKey}.${process.pid}.tmp.wav`);

      try {
        const wavArgs = [
          '-y',
          '-v',
          'error',
          '-i',
          sourcePath,
          '-vn',
          '-map_metadata',
          '-1',
          '-ar',
          '48000',
          '-ac',
          '2',
          '-c:a',
          'pcm_s16le',
          wavTempPath,
        ];

        const res = await this.runSpawnBuffer(this.ffmpegPath, wavArgs, 90000);
        if (res.code === 0 && fs.existsSync(wavTempPath) && fs.statSync(wavTempPath).size > 256) {
          fs.renameSync(wavTempPath, wavFinalPath);
          targetFileName = wavFileName;
          targetFinalPath = wavFinalPath;
          targetFormat = 'WAV';
          success = true;
        } else if (fs.existsSync(wavTempPath)) {
          fs.unlinkSync(wavTempPath);
        }
      } catch {
        if (fs.existsSync(wavTempPath)) {
          try {
            fs.unlinkSync(wavTempPath);
          } catch {
            // ignore
          }
        }
      }
    }

    if (!success || !fs.existsSync(targetFinalPath)) {
      this.markTrackUnplayable(trackId);
      return {
        status: 'unplayable',
        trackId,
        streamUrl: null,
        transcoded: false,
        error: `Unable to decode ${path.basename(sourcePath)}`,
      };
    }

    const stat = fs.statSync(targetFinalPath);
    const now = Date.now();
    const db = sqliteManager.getDatabase();

    db.prepare(`
      INSERT INTO transcode_cache (
        track_id, source_path, cache_file_name, target_format, file_size, created_at, last_accessed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(track_id) DO UPDATE SET
        source_path = excluded.source_path,
        cache_file_name = excluded.cache_file_name,
        target_format = excluded.target_format,
        file_size = excluded.file_size,
        last_accessed_at = excluded.last_accessed_at
    `).run(trackId, sourcePath, targetFileName, targetFormat, stat.size, now, now);

    // Ensure unplayable flag is cleared if it succeeded
    db.prepare('UPDATE tracks SET unplayable = 0 WHERE id = ?').run(trackId);

    // Enforce 2 GB LRU cache limit
    this.enforceLruCacheLimit(trackId);

    let loudnessGainDb: number | null = null;
    if (analyzeLoudness) {
      loudnessGainDb = await this.analyzeTrackLoudness(trackId).catch(() => 0);
    } else {
      const r = db
        .prepare<{ loudness_gain_db: number | null }>(
          'SELECT loudness_gain_db FROM tracks WHERE id = ?'
        )
        .get(trackId);
      loudnessGainDb = r?.loudness_gain_db ?? null;
    }

    return {
      status: 'ready',
      trackId,
      streamUrl: `/api/media/stream/${trackId}?transcoded=1`,
      transcoded: true,
      targetFormat,
      loudnessGainDb,
    };
  }

  /**
   * Analyzes track loudness using ffmpeg EBU R128 filter and caches the normalization gain (dB)
   * targeting -14.0 LUFS.
   */
  public async analyzeTrackLoudness(trackId: number): Promise<number> {
    const db = sqliteManager.getDatabase();
    const row = db
      .prepare<{ file_path: string; loudness_gain_db: number | null }>(
        'SELECT file_path, loudness_gain_db FROM tracks WHERE id = ?'
      )
      .get(trackId);

    if (!row) return 0;
    if (row.loudness_gain_db !== null && row.loudness_gain_db !== undefined) {
      return Number(row.loudness_gain_db);
    }

    const existingJob = this.inFlightLoudness.get(trackId);
    if (existingJob) return existingJob;

    const job = (async () => {
      let targetPath = row.file_path;
      const cachedTranscode = this.getCachedTranscodePath(trackId);
      if (cachedTranscode) {
        targetPath = cachedTranscode.filePath;
      }

      if (!fs.existsSync(targetPath)) return 0;

      try {
        const args = [
          '-nostats',
          '-t',
          '45',
          '-i',
          targetPath,
          '-af',
          'ebur128=framelog=verbose',
          '-f',
          'null',
          '-',
        ];
        const res = await this.runSpawnBuffer(this.ffmpegPath, args, 25000);
        const stderr = res.stderr || '';

        // Match Summary Integrated Loudness: "I:         -16.4 LUFS"
        const matches = [...stderr.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)];
        const lastMatch = matches[matches.length - 1];
        if (lastMatch && lastMatch[1]) {
          const integratedLufs = parseFloat(lastMatch[1]);
          if (Number.isFinite(integratedLufs) && integratedLufs > -70 && integratedLufs < 5) {
            // Target -14 LUFS standard reference
            const rawGain = -14.0 - integratedLufs;
            const clampedGain = Math.max(-12, Math.min(12, Number(rawGain.toFixed(2))));
            db.prepare('UPDATE tracks SET loudness_gain_db = ? WHERE id = ?').run(
              clampedGain,
              trackId
            );
            return clampedGain;
          }
        }
      } catch {
        // Ignore analysis error
      }

      db.prepare('UPDATE tracks SET loudness_gain_db = 0 WHERE id = ?').run(trackId);
      return 0;
    })();

    this.inFlightLoudness.set(trackId, job);
    try {
      return await job;
    } finally {
      this.inFlightLoudness.delete(trackId);
    }
  }

  public markTrackUnplayable(trackId: number): void {
    const db = sqliteManager.getDatabase();
    db.prepare('UPDATE tracks SET unplayable = 1 WHERE id = ?').run(trackId);
  }

  /**
   * Enforces the 2 GB LRU limit on the transcode cache directory.
   */
  public enforceLruCacheLimit(protectedTrackId?: number): void {
    const db = sqliteManager.getDatabase();
    const rows = db
      .prepare<{
        track_id: number;
        cache_file_name: string;
        file_size: number;
        last_accessed_at: number;
      }>(
        'SELECT track_id, cache_file_name, file_size, last_accessed_at FROM transcode_cache ORDER BY last_accessed_at ASC'
      )
      .all();

    let totalBytes = rows.reduce((acc, r) => acc + Number(r.file_size || 0), 0);
    if (totalBytes <= MAX_TRANSCODE_CACHE_BYTES) {
      return;
    }

    for (const row of rows) {
      if (totalBytes <= MAX_TRANSCODE_CACHE_BYTES) break;
      if (protectedTrackId !== undefined && row.track_id === protectedTrackId) continue;

      const filePath = path.join(this.transcodeCacheDir, path.basename(row.cache_file_name));
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // ignore
      }

      db.prepare('DELETE FROM transcode_cache WHERE track_id = ?').run(row.track_id);
      totalBytes -= Number(row.file_size || 0);
    }
  }

  public getCacheStats(): TranscodeCacheStats {
    const db = sqliteManager.getDatabase();
    let totalBytes = 0;
    let fileCount = 0;

    try {
      if (fs.existsSync(this.transcodeCacheDir)) {
        const entries = fs.readdirSync(this.transcodeCacheDir);
        for (const name of entries) {
          if (name.startsWith('.') || name.includes('.tmp.')) continue;
          const full = path.join(this.transcodeCacheDir, name);
          try {
            const st = fs.statSync(full);
            if (st.isFile()) {
              fileCount++;
              totalBytes += st.size;
            }
          } catch {
            // ignore
          }
        }
      }
    } catch {
      const row = db
        .prepare<{ cnt: number; bytes: number }>(
          'SELECT COUNT(track_id) AS cnt, COALESCE(SUM(file_size), 0) AS bytes FROM transcode_cache'
        )
        .get();
      fileCount = Number(row?.cnt || 0);
      totalBytes = Number(row?.bytes || 0);
    }

    return {
      fileCount,
      totalBytes,
      maxBytes: MAX_TRANSCODE_CACHE_BYTES,
      cacheDir: this.transcodeCacheDir,
    };
  }

  public clearCache(): TranscodeCacheStats {
    const db = sqliteManager.getDatabase();
    db.prepare('DELETE FROM transcode_cache').run();

    if (fs.existsSync(this.transcodeCacheDir)) {
      const entries = fs.readdirSync(this.transcodeCacheDir);
      for (const name of entries) {
        const full = path.join(this.transcodeCacheDir, name);
        try {
          if (fs.statSync(full).isFile()) {
            fs.unlinkSync(full);
          }
        } catch {
          // ignore
        }
      }
    }

    return this.getCacheStats();
  }
}

export const ffmpegService = new FfmpegService();
