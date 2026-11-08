import express, { type Request, type Response } from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { libraryService } from './electron/main/services/libraryService.ts';
import { playerService } from './electron/main/services/playerService.ts';
import { lyricsService } from './electron/main/services/lyricsService.ts';
import { canvasService } from './electron/main/services/canvasService.ts';
import { jamService } from './electron/main/services/jamService.ts';
import { ffmpegService } from './electron/main/services/ffmpegService.ts';
import { updaterService } from './electron/main/services/updaterService.ts';
import { fontService } from './electron/main/services/fontService.ts';
import type { LibraryEventPayload } from './src/shared/ipcTypes.ts';

const PORT = 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 150 * 1024 * 1024, // 150MB per audio file
    files: 500,
  },
});

async function startServer() {
  await libraryService.initialize();

  const app = express();
  app.use(express.json({ limit: '48mb' }));

  const sseClients = new Set<Response>();

  libraryService.on('library:event', (payload: LibraryEventPayload) => {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) {
      client.write(data);
    }
  });

  app.get('/api/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  // Library API routes
  app.get('/api/library/tracks', (req: Request, res: Response) => {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    res.json(libraryService.getTracks(search));
  });

  app.get('/api/library/tracks/:id/audio-info', async (req: Request, res: Response) => {
    try {
      res.json(await libraryService.getTrackAudioInfo(Number(req.params.id)));
    } catch {
      res.json(null);
    }
  });

  app.get('/api/library/albums', (req: Request, res: Response) => {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    res.json(libraryService.getAlbums(search));
  });

  app.get('/api/library/artists', (req: Request, res: Response) => {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    res.json(libraryService.getArtists(search));
  });

  app.get('/api/library/album-tracks', (req: Request, res: Response) => {
    const album = typeof req.query.album === 'string' ? req.query.album : '';
    const artist = typeof req.query.artist === 'string' ? req.query.artist : undefined;
    res.json(libraryService.getAlbumTracks(album, artist));
  });

  app.get('/api/library/artist-tracks', (req: Request, res: Response) => {
    const artist = typeof req.query.artist === 'string' ? req.query.artist : '';
    res.json(libraryService.getArtistTracks(artist));
  });

  app.get('/api/library/folders', (_req: Request, res: Response) => {
    res.json(libraryService.getFolders());
  });

  app.get('/api/library/available-folders', (_req: Request, res: Response) => {
    res.json(libraryService.getAvailableServerFolders());
  });

  app.get('/api/library/stats', (_req: Request, res: Response) => {
    res.json(libraryService.getStats());
  });

  app.post('/api/library/folders', async (req: Request, res: Response) => {
    const folderPath = req.body?.folderPath;
    if (!folderPath || typeof folderPath !== 'string') {
      res.status(400).json({ added: false, error: 'folderPath is required' });
      return;
    }
    const result = await libraryService.addFolder(folderPath);
    res.json(result);
  });

  app.post('/api/library/upload-folder', upload.array('files'), async (req: Request, res: Response) => {
    try {
      const rawFolderName = (req.body?.folderName || 'Imported Music').toString();
      const safeFolderName = rawFolderName.replace(/[^a-zA-Z0-9 _.-]/g, '').trim() || 'Imported Music';
      const targetDir = path.resolve(process.cwd(), 'data', 'music', safeFolderName);

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const files = (req.files as Express.Multer.File[]) || [];
      let relativePaths: string[] = [];
      if (typeof req.body?.relativePaths === 'string') {
        try {
          relativePaths = JSON.parse(req.body.relativePaths);
        } catch {
          relativePaths = [];
        }
      }

      let writtenCount = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const rel = relativePaths[i] || file.originalname;
        const parts = rel.split(/[\\/]/).filter(Boolean);
        const subParts = parts.length > 1 ? parts.slice(1) : parts;
        const cleanRel = subParts.join(path.sep);
        const destPath = path.join(targetDir, cleanRel);

        const ext = path.extname(destPath).toLowerCase();
        const isSidecarLyrics = ext === '.ttml' || ext === '.lrc';
        if (!libraryService.isSupportedAudioFile(destPath) && !isSidecarLyrics) {
          continue;
        }

        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        fs.writeFileSync(destPath, file.buffer);
        if (!isSidecarLyrics) {
          writtenCount++;
        }
      }

      if (writtenCount === 0) {
        res.json({
          added: false,
          error:
            'No supported audio files (mp3, flac, wav, ogg, opus, m4a, aac, alac, wma, ape, wv, aiff, aif, dsf, dff) found in the selected folder.',
        });
        return;
      }

      const result = await libraryService.addFolder(targetDir);
      res.json(result);
    } catch (err) {
      res.status(500).json({ added: false, error: String(err) });
    }
  });

  app.delete('/api/library/folders/:id', async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    await libraryService.removeFolder(id);
    res.json({ ok: true });
  });

  app.post('/api/library/rescan', async (_req: Request, res: Response) => {
    await libraryService.rescanAllFolders();
    res.json({ ok: true });
  });

  app.post('/api/library/reset-unplayable', (_req: Request, res: Response) => {
    res.json(libraryService.resetUnplayableTracks());
  });

  // ============================================================================
  // Playlists & Favorites REST Routes (SQLite)
  // ============================================================================

  app.get('/api/playlists', (_req: Request, res: Response) => {
    res.json(libraryService.getPlaylists());
  });

  app.get('/api/playlists/favorites', (req: Request, res: Response) => {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    res.json(libraryService.getFavoriteTracks(search));
  });

  app.post('/api/playlists/favorites/toggle', (req: Request, res: Response) => {
    const trackId = Number(req.body?.trackId);
    res.json(libraryService.toggleFavoriteTrack(trackId));
  });

  app.get('/api/playlists/:id/tracks', (req: Request, res: Response) => {
    const playlistId = Number(req.params.id);
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    res.json(libraryService.getPlaylistTracks(playlistId, search));
  });

  app.post('/api/playlists', (req: Request, res: Response) => {
    const name = (req.body?.name || 'Untitled Playlist').toString();
    const description = (req.body?.description || '').toString();
    res.json(libraryService.createPlaylist(name, description));
  });

  app.put('/api/playlists/:id', (req: Request, res: Response) => {
    const playlistId = Number(req.params.id);
    const name = (req.body?.name || 'Untitled Playlist').toString();
    const description =
      typeof req.body?.description === 'string' ? req.body.description : undefined;
    res.json(libraryService.renamePlaylist(playlistId, name, description));
  });

  app.delete('/api/playlists/:id', (req: Request, res: Response) => {
    const playlistId = Number(req.params.id);
    libraryService.deletePlaylist(playlistId);
    res.json({ ok: true });
  });

  app.post('/api/playlists/:id/tracks', (req: Request, res: Response) => {
    const playlistId = Number(req.params.id);
    const trackId = Number(req.body?.trackId);
    libraryService.addTrackToPlaylist(playlistId, trackId);
    res.json({ ok: true });
  });

  app.delete('/api/playlists/:id/tracks/:entryId', (req: Request, res: Response) => {
    const playlistId = Number(req.params.id);
    const entryId = Number(req.params.entryId);
    libraryService.removeTrackFromPlaylist(playlistId, entryId);
    res.json({ ok: true });
  });

  app.put('/api/playlists/:id/reorder', (req: Request, res: Response) => {
    const playlistId = Number(req.params.id);
    const orderedEntryIds = Array.isArray(req.body?.orderedEntryIds)
      ? req.body.orderedEntryIds.map(Number)
      : [];
    libraryService.reorderPlaylistTracks(playlistId, orderedEntryIds);
    res.json({ ok: true });
  });

  // Player state routes
  app.get('/api/player/state', (_req: Request, res: Response) => {
    res.json(playerService.getPlayerState());
  });

  app.post('/api/player/state', (req: Request, res: Response) => {
    const updated = playerService.savePlayerState(req.body || {});
    res.json(updated);
  });

  app.get('/api/player/history', (req: Request, res: Response) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(playerService.getHistory(limit));
  });

  app.post('/api/player/history/clear', (_req: Request, res: Response) => {
    playerService.clearHistory();
    res.json({ ok: true });
  });

  app.get('/api/fonts', (_req: Request, res: Response) => {
    res.json(fontService.list());
  });

  app.post('/api/fonts', (req: Request, res: Response) => {
    try {
      res.json(fontService.save(String(req.body?.fileName ?? ''), String(req.body?.dataBase64 ?? '')));
    } catch (err: any) {
      res.status(400).json({ error: err?.message ?? 'Could not save the font' });
    }
  });

  app.get('/api/fonts/:id/data', (req: Request, res: Response) => {
    res.json({ data: fontService.getData(String(req.params.id)) });
  });

  app.delete('/api/fonts/:id', (req: Request, res: Response) => {
    fontService.remove(String(req.params.id));
    res.json({ ok: true });
  });

  app.get('/api/stats', (_req: Request, res: Response) => {
    res.json(playerService.getListeningStats());
  });

  app.post('/api/stats/reset', (_req: Request, res: Response) => {
    playerService.resetListeningStats();
    res.json({ ok: true });
  });

  app.post('/api/stats/listened', (req: Request, res: Response) => {
    playerService.addListenedSeconds(Number(req.body?.trackId), Number(req.body?.seconds));
    res.json({ ok: true });
  });

  app.post('/api/player/history', (req: Request, res: Response) => {
    const trackId = Number(req.body?.trackId);
    playerService.addHistoryEntry(trackId);
    res.json({ ok: true });
  });

  // Cached cover art serving route
  app.get('/api/media/cover/:filename', (req: Request, res: Response) => {
    const safeName = path.basename(req.params.filename);
    const filePath = path.join(libraryService.getCoverCacheDir(), safeName);
    if (!fs.existsSync(filePath)) {
      res.status(404).end();
      return;
    }
    const ext = path.extname(safeName).toLowerCase();
    const contentType =
      ext === '.svg'
        ? 'image/svg+xml'
        : ext === '.png'
        ? 'image/png'
        : ext === '.webp'
        ? 'image/webp'
        : 'image/jpeg';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    fs.createReadStream(filePath).pipe(res);
  });

  // Audio byte-range streaming route for native HTML5 <audio> element (and FFmpeg transcoded cache)
  app.get('/api/media/stream/:trackId', async (req: Request, res: Response) => {
    const trackId = Number(req.params.trackId);
    const preferTranscoded = req.query.transcoded === '1' || req.query.transcoded === 'true';

    const track = libraryService.getTrackById(trackId);
    if (
      track &&
      (preferTranscoded ||
        ffmpegService.requiresTranscoding(track.filePath, track.format, track.codec))
    ) {
      const prepared = await ffmpegService.prepareTrack(trackId, preferTranscoded, false);
      if (prepared.status === 'unplayable') {
        res.status(415).send(prepared.error || 'Track is unplayable');
        return;
      }
    }

    const resolved = playerService.resolveAudioFileForTrack(trackId, preferTranscoded);
    if (!resolved) {
      res.status(404).send('Audio track not found');
      return;
    }

    const { filePath, mimeType, stat } = resolved;
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
      });

      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Accept-Ranges': 'bytes',
        'Content-Length': fileSize,
        'Content-Type': mimeType,
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // Synced Lyrics & Other Service routes
  app.get('/api/services/lyrics/:trackId', async (req: Request, res: Response) => {
    const trackId = Number(req.params.trackId);
    const forceRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
    res.json(await lyricsService.getLyrics(trackId, forceRefresh));
  });

  app.post('/api/services/lyrics/:trackId/offset', (req: Request, res: Response) => {
    const trackId = Number(req.params.trackId);
    const offset = Number(req.body?.offset || 0);
    res.json(lyricsService.saveLyricsOffset(trackId, offset));
  });

  app.post('/api/services/lyrics/:trackId/isrc', async (req: Request, res: Response) => {
    const trackId = Number(req.params.trackId);
    const isrcOrUrl = (req.body?.isrcOrUrl || '').toString();
    res.json(await lyricsService.saveTrackIsrcAndFetch(trackId, isrcOrUrl));
  });

  // Cached Spotify Canvas video serving route with byte-range streaming
  app.get('/api/media/canvas/:filename', (req: Request, res: Response) => {
    const safeName = path.basename(req.params.filename);
    const filePath = path.join(canvasService.getCanvasCacheDir(), safeName);
    if (!fs.existsSync(filePath)) {
      res.status(404).end();
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const ext = path.extname(safeName).toLowerCase();
    const contentType = ext === '.webm' ? 'video/webm' : 'video/mp4';
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Accept-Ranges': 'bytes',
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  app.get('/api/services/canvas/:trackId', async (req: Request, res: Response) => {
    const trackId = Number(req.params.trackId);
    const forceRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
    res.json(await canvasService.getCanvasForTrack(trackId, forceRefresh));
  });

  app.post('/api/services/canvas/:trackId/link', async (req: Request, res: Response) => {
    const trackId = Number(req.params.trackId);
    const spotifyInput = (req.body?.spotifyInput || '').toString();
    res.json(await canvasService.linkSpotifyTrackForCanvas(trackId, spotifyInput));
  });

  app.get('/api/services/canvas-cache/stats', (_req: Request, res: Response) => {
    res.json(canvasService.getCacheStats());
  });

  app.post('/api/services/canvas-cache/clear', (_req: Request, res: Response) => {
    res.json(canvasService.clearCache());
  });

  app.get('/api/services/jam', async (_req: Request, res: Response) => {
    res.json(await jamService.getStatus());
  });

  app.post('/api/services/jam/rtc-config', (req: Request, res: Response) => {
    res.json(jamService.saveRtcConfig(req.body || {}));
  });

  app.get('/api/services/jam/chromaprint/:trackId', async (req: Request, res: Response) => {
    const trackId = Number(req.params.trackId);
    const chromaprint = await jamService.getOrComputeTrackChromaprint(trackId);
    res.json({ trackId, chromaprint });
  });

  app.post('/api/services/jam/fingerprints/compute', async (_req: Request, res: Response) => {
    res.json(await jamService.computeLibraryFingerprintsInBackground());
  });

  // FFmpeg Transcoding, Loudness Normalization & 2 GB LRU Cache Routes
  app.get('/api/services/ffmpeg', async (_req: Request, res: Response) => {
    res.json(await ffmpegService.getStatus());
  });

  app.post('/api/services/ffmpeg/prepare/:trackId', async (req: Request, res: Response) => {
    const trackId = Number(req.params.trackId);
    const forceTranscode = Boolean(req.body?.forceTranscode);
    const analyzeLoudness = Boolean(req.body?.analyzeLoudness);
    res.json(await ffmpegService.prepareTrack(trackId, forceTranscode, analyzeLoudness));
  });

  app.post('/api/services/ffmpeg/pretranscode/:trackId', async (req: Request, res: Response) => {
    const trackId = Number(req.params.trackId);
    const analyzeLoudness = Boolean(req.body?.analyzeLoudness);
    res.json(await ffmpegService.prepareTrack(trackId, false, analyzeLoudness));
  });

  app.post('/api/services/ffmpeg/loudness/:trackId', async (req: Request, res: Response) => {
    const trackId = Number(req.params.trackId);
    const gainDb = await ffmpegService.analyzeTrackLoudness(trackId);
    res.json({ gainDb });
  });

  app.post('/api/services/ffmpeg/unplayable/:trackId', (req: Request, res: Response) => {
    const trackId = Number(req.params.trackId);
    ffmpegService.markTrackUnplayable(trackId);
    res.json({ ok: true });
  });

  app.get('/api/services/ffmpeg/cache-stats', (_req: Request, res: Response) => {
    res.json(ffmpegService.getCacheStats());
  });

  app.post('/api/services/ffmpeg/cache-clear', (_req: Request, res: Response) => {
    res.json(ffmpegService.clearCache());
  });

  // Unified Cache Stats & Cleanup Routes
  app.get('/api/services/caches/all', (_req: Request, res: Response) => {
    res.json({
      coverCache: libraryService.getCoverCacheStats(),
      lyricsCache: lyricsService.getCacheStats(),
      canvasCache: canvasService.getCacheStats(),
      transcodeCache: ffmpegService.getCacheStats(),
    });
  });

  app.post('/api/services/caches/cover/clear', (_req: Request, res: Response) => {
    res.json(libraryService.clearCoverCache());
  });

  app.post('/api/services/caches/lyrics/clear', (_req: Request, res: Response) => {
    res.json(lyricsService.clearCache());
  });

  // Auto-Updater Routes (electron-builder com.aestheticy.app)
  app.get('/api/services/updater', (_req: Request, res: Response) => {
    res.json(updaterService.getStatus());
  });

  app.post('/api/services/updater/auto-update', (req: Request, res: Response) => {
    const enabled = Boolean(req.body?.enabled);
    res.json(updaterService.setAutoUpdateEnabled(enabled));
  });

  app.post('/api/services/updater/check', async (_req: Request, res: Response) => {
    res.json(await updaterService.checkForUpdates());
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  jamService.attachSignalingServer(httpServer);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Aestheticy server listening on http://localhost:${PORT}`);
  });
}

startServer();
