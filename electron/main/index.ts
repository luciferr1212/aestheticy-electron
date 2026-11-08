import './bootstrapEnv.ts'; // must stay first: points data/cache folders at the per-user userData dir
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  screen,
} from 'electron';
import { Readable } from 'stream';
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { libraryService } from './services/libraryService.ts';
import { playerService } from './services/playerService.ts';
import { lyricsService } from './services/lyricsService.ts';
import { canvasService } from './services/canvasService.ts';
import { jamService } from './services/jamService.ts';
import { ffmpegService } from './services/ffmpegService.ts';
import { updaterService } from './services/updaterService.ts';
import { fontService } from './services/fontService.ts';
import type {
  LibraryEventPayload,
  PersistedPlayerState,
  DesktopSettings,
  Track,
  TrayCommandPayload,
} from '../../src/shared/ipcTypes.ts';

// Custom audio protocol used by the desktop build: aestheticy-media://track/<id>
// Must be registered as privileged BEFORE the app is ready so <audio> can stream it
// (range requests / seeking), and so the Web Audio equalizer can read the samples (CORS).
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'aestheticy-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
]);

// Media keys are handled by the globalShortcut bindings below. Without this Chromium would
// ALSO react to the same key press and play/pause would toggle twice (= nothing happens).
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.flac', '.wav', '.ogg', '.opus', '.m4a', '.aac',
  '.alac', '.wma', '.ape', '.wv', '.aiff', '.aif', '.dsf', '.dff',
]);

const assetsDir = path.join(__dirname, '../../electron/assets');
const asset = (name: string): string => path.join(assetsDir, name);

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

const DEFAULT_WINDOW_STATE: WindowState = { width: 1440, height: 900, isMaximized: false };

const startHidden = process.argv.includes('--hidden');
let isQuitting = false;

interface StoredDesktopSettings {
  closeToTray: boolean;
}

function desktopSettingsFile(): string {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function readStoredDesktopSettings(): StoredDesktopSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(desktopSettingsFile(), 'utf8'));
    return { closeToTray: Boolean(raw.closeToTray) };
  } catch {
    return { closeToTray: false };
  }
}

function getDesktopSettings(): DesktopSettings {
  return {
    isDesktop: true,
    closeToTray: readStoredDesktopSettings().closeToTray,
    launchAtStartup: app.getLoginItemSettings().openAtLogin,
  };
}

function setDesktopSettings(
  patch: Partial<Omit<DesktopSettings, 'isDesktop'>>
): DesktopSettings {
  if (typeof patch.closeToTray === 'boolean') {
    try {
      fs.mkdirSync(path.dirname(desktopSettingsFile()), { recursive: true });
      fs.writeFileSync(
        desktopSettingsFile(),
        JSON.stringify({ closeToTray: patch.closeToTray })
      );
    } catch {
      // non-critical
    }
  }
  if (typeof patch.launchAtStartup === 'boolean' && app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: patch.launchAtStartup,
      args: patch.launchAtStartup ? ['--hidden'] : [],
    });
  }
  return getDesktopSettings();
}

let isMiniPlayerActive = false;
let preMiniWasMaximized = false;
const MINI_WIDTH = 392;
const MINI_HEIGHT = 140;
// Remembers where the user last dragged the mini player during this session.
let lastMiniPosition: { x: number; y: number } | null = null;
const MAIN_MIN_WIDTH = 640;
const MAIN_MIN_HEIGHT = 480;

function getWindowInfo(): WindowInfo {
  const display = mainWindow && !mainWindow.isDestroyed()
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay();
  const [width, height] = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getSize() : [0, 0];
  return {
    isFullScreen: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()),
    isMaximized: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()),
    width,
    height,
    screenWidth: display.size.width,
    screenHeight: display.size.height,
  };
}
let preMiniBounds: Electron.Rectangle | null = null;
let saveWindowStateTimer: NodeJS.Timeout | null = null;
let pendingOpenFile: string | null = null;

function windowStateFile(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState(): WindowState {
  try {
    const raw = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'));
    const state: WindowState = {
      width: Math.max(360, Number(raw.width) || DEFAULT_WINDOW_STATE.width),
      height: Math.max(420, Number(raw.height) || DEFAULT_WINDOW_STATE.height),
      isMaximized: Boolean(raw.isMaximized),
    };
    if (typeof raw.x === 'number' && typeof raw.y === 'number') {
      // Only restore the position if it is still on a connected monitor.
      const visible = screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return (
          raw.x < a.x + a.width - 80 &&
          raw.x + state.width > a.x + 80 &&
          raw.y >= a.y - 10 &&
          raw.y < a.y + a.height - 80
        );
      });
      if (visible) {
        state.x = raw.x;
        state.y = raw.y;
      }
    }
    return state;
  } catch {
    return { ...DEFAULT_WINDOW_STATE };
  }
}

function saveWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed() || isMiniPlayerActive || mainWindow.isMinimized()) {
    return;
  }
  try {
    const b = mainWindow.getNormalBounds();
    const state: WindowState = {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      isMaximized: mainWindow.isMaximized(),
    };
    fs.mkdirSync(path.dirname(windowStateFile()), { recursive: true });
    fs.writeFileSync(windowStateFile(), JSON.stringify(state));
  } catch {
    // non-critical
  }
}

function scheduleSaveWindowState(): void {
  if (saveWindowStateTimer) clearTimeout(saveWindowStateTimer);
  saveWindowStateTimer = setTimeout(saveWindowState, 600);
}

/** Taskbar thumbnail toolbar (Windows): Previous / Play-Pause / Next under the preview. */
function updateThumbarButtons(): void {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;
  const icon = (name: string) => nativeImage.createFromPath(asset(name));
  try {
    mainWindow.setThumbarButtons([
      { tooltip: 'Previous', icon: icon('thumb-prev.png'), click: () => sendTrayCommand('previous') },
      {
        tooltip: trayPlaybackInfo.isPlaying ? 'Pause' : 'Play',
        icon: icon(trayPlaybackInfo.isPlaying ? 'thumb-pause.png' : 'thumb-play.png'),
        click: () => sendTrayCommand('toggle-play'),
      },
      { tooltip: 'Next', icon: icon('thumb-next.png'), click: () => sendTrayCommand('next') },
    ]);
  } catch {
    // Thumbnail toolbar is a nicety; never crash over it.
  }
}

function registerGlobalShortcuts(): void {
  const bindings: [string, TrayCommandPayload['action']][] = [
    ['MediaPlayPause', 'toggle-play'],
    ['MediaNextTrack', 'next'],
    ['MediaPreviousTrack', 'previous'],
    ['CommandOrControl+Alt+Space', 'toggle-play'],
    ['CommandOrControl+Alt+Right', 'next'],
    ['CommandOrControl+Alt+Left', 'previous'],
  ];
  for (const [accelerator, action] of bindings) {
    try {
      globalShortcut.register(accelerator, () => sendTrayCommand(action));
    } catch {
      // Another app owns this shortcut; skip it.
    }
  }
  try {
    globalShortcut.register('MediaStop', () => {
      if (trayPlaybackInfo.isPlaying) sendTrayCommand('toggle-play');
    });
  } catch {
    // ignore
  }
}

function findAudioFileInArgs(args: string[]): string | null {
  for (const arg of args) {
    if (!arg || arg.startsWith('-')) continue;
    if (!AUDIO_EXTENSIONS.has(path.extname(arg).toLowerCase())) continue;
    try {
      if (fs.existsSync(arg) && fs.statSync(arg).isFile()) return path.resolve(arg);
    } catch {
      // ignore unreadable path
    }
  }
  return null;
}

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let systemTray: Tray | null = null;
let embeddedServerUrl: string | null = null;
let trayPlaybackInfo = {
  title: 'Aestheticy',
  artist: 'Ready to Play',
  isPlaying: false,
};

async function ensureEmbeddedMediaServer(): Promise<string> {
  if (embeddedServerUrl) return embeddedServerUrl;

  const exp = express();
  const httpServer = http.createServer(exp);
  jamService.attachSignalingServer(httpServer);

  exp.use('/api/media/cover', express.static(libraryService.getCoverCacheDir()));
  exp.use('/api/media/canvas', express.static(canvasService.getCanvasCacheDir()));

  exp.get('/api/media/stream/:trackId', async (req, res) => {
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
      res.status(404).send('Audio file not found');
      return;
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', resolved.mimeType);
    res.sendFile(resolved.filePath);
  });

  const distDir = path.join(__dirname, '../../dist');
  if (fs.existsSync(distDir)) {
    exp.use(express.static(distDir));
    exp.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return new Promise<string>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : 3000;
      embeddedServerUrl = `http://127.0.0.1:${port}`;
      resolve(embeddedServerUrl);
    });
  });
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
};

/**
 * Serves a local file with full HTTP Range support (206 Partial Content), streaming only
 * the requested bytes so seeking in long FLAC/WAV files is instant and memory-light.
 */
function serveFileWithRange(
  request: Request,
  filePath: string,
  mimeType: string,
  size: number
): Response {
  const baseHeaders: Record<string, string> = {
    ...CORS_HEADERS,
    'Content-Type': mimeType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  };

  const rangeHeader = request.headers.get('range');
  let start = 0;
  let end = size - 1;
  let partial = false;

  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match || (match[1] === '' && match[2] === '')) {
      return new Response(null, {
        status: 416,
        headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` },
      });
    }
    if (match[1] === '') {
      // Suffix range: last N bytes
      const suffix = Number(match[2]);
      start = Math.max(0, size - suffix);
    } else {
      start = Number(match[1]);
      if (match[2] !== '') end = Math.min(Number(match[2]), size - 1);
    }
    if (start >= size || start > end) {
      return new Response(null, {
        status: 416,
        headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` },
      });
    }
    partial = true;
  }

  if (size === 0) {
    return new Response(null, { status: 200, headers: { ...baseHeaders, 'Content-Length': '0' } });
  }

  const length = end - start + 1;
  const nodeStream = fs.createReadStream(filePath, { start, end });
  const body = Readable.toWeb(nodeStream) as unknown as ReadableStream;

  const headers: Record<string, string> = { ...baseHeaders, 'Content-Length': String(length) };
  if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;

  if (request.method === 'HEAD') {
    nodeStream.destroy();
    return new Response(null, { status: partial ? 206 : 200, headers });
  }
  return new Response(body, { status: partial ? 206 : 200, headers });
}

async function handleMediaProtocolRequest(request: Request): Promise<Response> {
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    if (url.hostname !== 'track') {
      return new Response('Bad Request', { status: 400, headers: CORS_HEADERS });
    }
    const trackId = Number(url.pathname.replace(/^\/+/, ''));
    if (!Number.isFinite(trackId)) {
      return new Response('Bad Request', { status: 400, headers: CORS_HEADERS });
    }
    const preferTranscoded =
      url.searchParams.get('transcoded') === '1' || url.searchParams.get('transcoded') === 'true';

    // ALAC / WMA / APE / WV / AIFF / DSD (or a forced retry) are transcoded to FLAC first.
    const track = libraryService.getTrackById(trackId);
    if (
      track &&
      (preferTranscoded ||
        ffmpegService.requiresTranscoding(track.filePath, track.format, track.codec))
    ) {
      const prepared = await ffmpegService.prepareTrack(trackId, preferTranscoded, false);
      if (prepared.status === 'unplayable') {
        return new Response(prepared.error || 'Track is unplayable', {
          status: 415,
          headers: CORS_HEADERS,
        });
      }
    }

    const resolved = playerService.resolveAudioFileForTrack(trackId, preferTranscoded);
    if (!resolved) {
      return new Response('Audio file not found', { status: 404, headers: CORS_HEADERS });
    }
    return serveFileWithRange(request, resolved.filePath, resolved.mimeType, resolved.stat.size);
  } catch (err) {
    return new Response(`Media error: ${String(err)}`, { status: 500, headers: CORS_HEADERS });
  }
}

let splashShownAt = 0;
const SPLASH_MIN_MS = 4300; // lets the whole intro animation play even when the app loads instantly

function createSplashWindow(): void {
  // 16:9 splash drawn from electron/assets/splash.html (+ splash.jpg), all local: no internet needed.
  splashWindow = new BrowserWindow({
    width: 800,
    height: 450,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    center: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    icon: asset('icon.png'),
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  splashShownAt = Date.now();

  splashWindow.loadFile(asset('splash.html')).catch(() => {
    // If the file is missing for any reason, never block the app: just skip the splash.
    closeSplashWindow();
  });

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

/** Keeps the splash up long enough for its animation, fades it out, then closes it. */
async function closeSplashWindowGracefully(): Promise<void> {
  const win = splashWindow;
  if (!win || win.isDestroyed()) return;
  const wait = splashShownAt + SPLASH_MIN_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  try {
    if (!win.isDestroyed()) {
      await win.webContents.executeJavaScript("document.body.classList.add('out')");
      await new Promise((r) => setTimeout(r, 480));
    }
  } catch {
    // ignore: just close
  }
  closeSplashWindow();
}

function closeSplashWindow(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

async function createMainWindow(): Promise<void> {
  const preloadCjs = path.join(__dirname, '../preload/index.cjs');
  const preloadJs = path.join(__dirname, '../preload/index.js');
  const preloadPath = fs.existsSync(preloadCjs) ? preloadCjs : preloadJs;

  const windowState = loadWindowState();

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    icon: asset('icon.png'),
    minWidth: MAIN_MIN_WIDTH,
    minHeight: MAIN_MIN_HEIGHT,
    frame: false,
    transparent: true,
    backgroundMaterial: 'acrylic',
    backgroundColor: '#00000000',
    title: 'Aestheticy',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.once('ready-to-show', () => {
    closeSplashWindowGracefully()
      .catch(() => {})
      .finally(() => {
        if (!startHidden) mainWindow?.show();
        updateThumbarButtons();
      });
  });

  // Remember size / position / maximized state between launches
  mainWindow.on('resize', scheduleSaveWindowState);
  mainWindow.on('move', scheduleSaveWindowState);
  mainWindow.on('maximize', scheduleSaveWindowState);
  mainWindow.on('unmaximize', scheduleSaveWindowState);
  mainWindow.on('close', saveWindowState);

  // "Close to tray": the X button hides the window and music keeps playing.
  mainWindow.on('close', (event) => {
    if (!isQuitting && readStoredDesktopSettings().closeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // Apply Windows 11 Acrylic/Mica backdrop material where supported
  try {
    mainWindow.setBackgroundMaterial?.('acrylic');
  } catch {
    try {
      mainWindow.setBackgroundMaterial?.('mica');
    } catch {
      // Fallback handled by CSS backdrop-filter
    }
  }

  try {
    const isPackagedOrProd = app.isPackaged || process.env.NODE_ENV === 'production';
    if (!isPackagedOrProd && process.env.VITE_DEV_SERVER_URL) {
      await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else if (!isPackagedOrProd && !fs.existsSync(path.join(__dirname, '../../dist/index.html'))) {
      await mainWindow.loadURL('http://localhost:3000');
    } else {
      const localUrl = await ensureEmbeddedMediaServer();
      await mainWindow.loadURL(localUrl);
    }
  } finally {
    // Never leave the splash on screen (or the window hidden) if loading is slow or fails.
    await closeSplashWindowGracefully();
    if (!startHidden && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sendTrayCommand(action: TrayCommandPayload['action']): void {
  if (mainWindow) {
    mainWindow.webContents.send('tray:command', { action });
  }
}

function rebuildTrayMenu(): void {
  if (!systemTray) return;
  const statusLabel = trayPlaybackInfo.title
    ? `${trayPlaybackInfo.isPlaying ? '▶' : '⏸'} ${trayPlaybackInfo.title} — ${trayPlaybackInfo.artist}`
    : 'Aestheticy — Idle';

  const contextMenu = Menu.buildFromTemplate([
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    {
      label: trayPlaybackInfo.isPlaying ? 'Pause' : 'Play',
      click: () => sendTrayCommand('toggle-play'),
    },
    {
      label: 'Next Track',
      click: () => sendTrayCommand('next'),
    },
    {
      label: 'Previous Track',
      click: () => sendTrayCommand('previous'),
    },
    { type: 'separator' },
    {
      label: 'Toggle Mini Player',
      click: () => {
        mainWindow?.show();
        sendTrayCommand('toggle-mini-player');
      },
    },
    {
      label: 'Show Aestheticy Window',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
        sendTrayCommand('show-window');
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Aestheticy',
      click: () => app.quit(),
    },
  ]);

  systemTray.setToolTip(`Aestheticy · ${trayPlaybackInfo.title}`);
  systemTray.setContextMenu(contextMenu);
}

function createSystemTray(): void {
  const icon = nativeImage.createFromPath(asset('icon.png')).resize({ width: 16, height: 16 });

  systemTray = new Tray(icon);
  rebuildTrayMenu();

  systemTray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function registerIpcHandlers(): void {
  libraryService.on('library:event', (payload: LibraryEventPayload) => {
    if (mainWindow) {
      mainWindow.webContents.send('library:event', payload);
    }
  });

  // Library & Folder IPC
  ipcMain.handle('library:getTrackAudioInfo', (_evt, trackId: number) =>
    libraryService.getTrackAudioInfo(trackId)
  );
  ipcMain.handle('library:getTracks', (_evt, search?: string) => libraryService.getTracks(search));
  ipcMain.handle('library:getAlbums', (_evt, search?: string) => libraryService.getAlbums(search));
  ipcMain.handle('library:getArtists', (_evt, search?: string) => libraryService.getArtists(search));
  ipcMain.handle('library:getAlbumTracks', (_evt, album: string, artist?: string) =>
    libraryService.getAlbumTracks(album, artist)
  );
  ipcMain.handle('library:getArtistTracks', (_evt, artist: string) =>
    libraryService.getArtistTracks(artist)
  );
  ipcMain.handle('library:getFolders', () => libraryService.getFolders());
  ipcMain.handle('library:getStats', () => libraryService.getStats());
  ipcMain.handle('library:getAvailableServerFolders', () =>
    libraryService.getAvailableServerFolders()
  );

  ipcMain.handle('library:selectAndAddFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Music Folder to Add to Aestheticy',
      properties: ['openDirectory', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { added: false };
    }
    let lastAdded;
    for (const dirPath of result.filePaths) {
      lastAdded = await libraryService.addFolder(dirPath);
    }
    return lastAdded || { added: false };
  });

  ipcMain.handle('library:addFolderByPath', (_evt, folderPath: string) =>
    libraryService.addFolder(folderPath)
  );
  ipcMain.handle('library:removeFolder', (_evt, folderId: number) =>
    libraryService.removeFolder(folderId)
  );
  ipcMain.handle('library:rescanAllFolders', () => libraryService.rescanAllFolders());

  // Playlists & Favorites IPC
  ipcMain.handle('playlists:getAll', () => libraryService.getPlaylists());
  ipcMain.handle('playlists:getTracks', (_evt, playlistId: number, search?: string) =>
    libraryService.getPlaylistTracks(playlistId, search)
  );
  ipcMain.handle('playlists:create', (_evt, name: string, description?: string) =>
    libraryService.createPlaylist(name, description)
  );
  ipcMain.handle('playlists:rename', (_evt, playlistId: number, name: string, description?: string) =>
    libraryService.renamePlaylist(playlistId, name, description)
  );
  ipcMain.handle('playlists:delete', (_evt, playlistId: number) =>
    libraryService.deletePlaylist(playlistId)
  );
  ipcMain.handle('playlists:addTrack', (_evt, playlistId: number, trackId: number) =>
    libraryService.addTrackToPlaylist(playlistId, trackId)
  );
  ipcMain.handle('playlists:removeTrack', (_evt, playlistId: number, playlistEntryId: number) =>
    libraryService.removeTrackFromPlaylist(playlistId, playlistEntryId)
  );
  ipcMain.handle('playlists:reorder', (_evt, playlistId: number, orderedEntryIds: number[]) =>
    libraryService.reorderPlaylistTracks(playlistId, orderedEntryIds)
  );
  ipcMain.handle('playlists:toggleFavorite', (_evt, trackId: number) =>
    libraryService.toggleFavoriteTrack(trackId)
  );
  ipcMain.handle('playlists:getFavorites', (_evt, search?: string) =>
    libraryService.getFavoriteTracks(search)
  );

  // Player service IPC
  ipcMain.handle('player:getState', () => playerService.getPlayerState());
  ipcMain.handle('player:saveState', (_evt, state: Partial<PersistedPlayerState>) =>
    playerService.savePlayerState(state)
  );
  ipcMain.handle('player:getHistory', (_evt, limit?: number) => playerService.getHistory(limit));
  ipcMain.handle('player:clearHistory', () => playerService.clearHistory());
  ipcMain.handle('player:recordHistory', (_evt, trackId: number) =>
    playerService.addHistoryEntry(trackId)
  );
  ipcMain.handle('fonts:list', () => fontService.list());
  ipcMain.handle('fonts:save', (_evt, fileName: string, dataBase64: string) =>
    fontService.save(String(fileName), String(dataBase64))
  );
  ipcMain.handle('fonts:getData', (_evt, id: string) => fontService.getData(String(id)));
  ipcMain.handle('fonts:delete', (_evt, id: string) => fontService.remove(String(id)));

  ipcMain.handle('stats:get', () => playerService.getListeningStats());
  ipcMain.handle('stats:reset', () => playerService.resetListeningStats());
  ipcMain.handle('stats:addListened', (_evt, trackId: number, seconds: number) =>
    playerService.addListenedSeconds(trackId, seconds)
  );

  // "Open with Aestheticy" (file associations): the renderer asks for a file passed at launch
  ipcMain.handle('app:consumePendingOpenFile', async (): Promise<Track | null> => {
    const file = pendingOpenFile;
    pendingOpenFile = null;
    return file ? libraryService.ensureFileInLibrary(file) : null;
  });

  ipcMain.handle('app:getDesktopSettings', () => getDesktopSettings());
  ipcMain.handle(
    'app:setDesktopSettings',
    (_evt, patch: Partial<Omit<DesktopSettings, 'isDesktop'>>) => setDesktopSettings(patch || {})
  );

  // Window, Mini Player & System Tray IPC
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
  });
  ipcMain.handle('window:maximizeOrRestore', () => {
    if (!mainWindow) return { isMaximized: false };
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return { isMaximized: false };
    } else {
      mainWindow.maximize();
      return { isMaximized: true };
    }
  });
  ipcMain.handle('window:close', () => {
    mainWindow?.close();
  });
  ipcMain.handle('window:setMiniPlayer', (_evt, enabled: boolean) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (enabled) {
      if (!isMiniPlayerActive) {
        if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
        preMiniWasMaximized = mainWindow.isMaximized();
        if (preMiniWasMaximized) mainWindow.unmaximize();
        preMiniBounds = mainWindow.getBounds();
      }
      isMiniPlayerActive = true;
      // Compact Apple-Music-style window docked to the right edge of the screen.
      mainWindow.setMinimumSize(MINI_WIDTH, MINI_HEIGHT);
      mainWindow.setMaximumSize(MINI_WIDTH, MINI_HEIGHT);
      mainWindow.setResizable(false);
      mainWindow.setMaximizable(false);
      mainWindow.setAlwaysOnTop(true, 'floating');
      const area = screen.getDisplayMatching(preMiniBounds ?? mainWindow.getBounds()).workArea;
      let miniX = area.x + area.width - MINI_WIDTH - 16;
      let miniY = area.y + area.height - MINI_HEIGHT - 16;
      if (lastMiniPosition) {
        const saved = screen.getDisplayNearestPoint(lastMiniPosition).workArea;
        // Clamp so it can never reappear off-screen (monitor unplugged, resolution change...)
        miniX = Math.min(Math.max(lastMiniPosition.x, saved.x), saved.x + saved.width - MINI_WIDTH);
        miniY = Math.min(Math.max(lastMiniPosition.y, saved.y), saved.y + saved.height - MINI_HEIGHT);
      }
      mainWindow.setBounds({ x: miniX, y: miniY, width: MINI_WIDTH, height: MINI_HEIGHT }, true);
    } else {
      if (isMiniPlayerActive) {
        const b = mainWindow.getBounds();
        lastMiniPosition = { x: b.x, y: b.y };
      }
      isMiniPlayerActive = false;
      mainWindow.setAlwaysOnTop(false);
      mainWindow.setMaximumSize(0, 0);
      mainWindow.setMinimumSize(MAIN_MIN_WIDTH, MAIN_MIN_HEIGHT);
      mainWindow.setResizable(true);
      mainWindow.setMaximizable(true);
      if (preMiniBounds) {
        mainWindow.setBounds(preMiniBounds, true);
        preMiniBounds = null;
      } else {
        mainWindow.setSize(1440, 900, true);
        mainWindow.center();
      }
      if (preMiniWasMaximized) mainWindow.maximize();
      preMiniWasMaximized = false;
      scheduleSaveWindowState();
    }
  });
  ipcMain.handle('window:getInfo', () => getWindowInfo());
  ipcMain.handle('window:setFullScreen', (_evt, enabled: boolean) => {
    if (mainWindow && !mainWindow.isDestroyed() && !isMiniPlayerActive) {
      mainWindow.setFullScreen(Boolean(enabled));
    }
    return getWindowInfo();
  });
  ipcMain.handle('window:setSize', (_evt, width: number, height: number) => {
    if (mainWindow && !mainWindow.isDestroyed() && !isMiniPlayerActive) {
      if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      const area = screen.getDisplayMatching(mainWindow.getBounds()).workArea;
      const w = Math.min(Math.max(MAIN_MIN_WIDTH, Math.round(width) || 1440), area.width);
      const h = Math.min(Math.max(MAIN_MIN_HEIGHT, Math.round(height) || 900), area.height);
      mainWindow.setSize(w, h, true);
      mainWindow.center();
      scheduleSaveWindowState();
    }
    return getWindowInfo();
  });
  ipcMain.handle(
    'tray:updatePlaybackState',
    (_evt, state: { title: string; artist: string; isPlaying: boolean }) => {
      trayPlaybackInfo = state;
      rebuildTrayMenu();
      updateThumbarButtons();
    }
  );

  // Synced Lyrics & Other Services
  ipcMain.handle('lyrics:get', (_evt, trackId: number, forceRefresh?: boolean) =>
    lyricsService.getLyrics(trackId, forceRefresh)
  );
  ipcMain.handle('lyrics:saveOffset', (_evt, trackId: number, offset: number) =>
    lyricsService.saveLyricsOffset(trackId, offset)
  );
  ipcMain.handle('lyrics:saveIsrc', (_evt, trackId: number, isrcOrUrl: string) =>
    lyricsService.saveTrackIsrcAndFetch(trackId, isrcOrUrl)
  );
  ipcMain.handle('canvas:get', (_evt, trackId: number) => canvasService.getCanvasUrl(trackId));
  ipcMain.handle('canvas:getForTrack', (_evt, trackId: number, forceRefresh?: boolean) =>
    canvasService.getCanvasForTrack(trackId, forceRefresh)
  );
  ipcMain.handle('canvas:linkSpotifyTrack', (_evt, trackId: number, spotifyInput: string) =>
    canvasService.linkSpotifyTrackForCanvas(trackId, spotifyInput)
  );
  ipcMain.handle('canvas:getCacheStats', () => canvasService.getCacheStats());
  ipcMain.handle('canvas:clearCache', () => canvasService.clearCache());
  ipcMain.handle('jam:status', () => jamService.getStatus());
  ipcMain.handle('jam:saveRtcConfig', (_evt, config) => jamService.saveRtcConfig(config || {}));
  ipcMain.handle('jam:getChromaprint', async (_evt, trackId: number) => ({
    trackId,
    chromaprint: await jamService.getOrComputeTrackChromaprint(trackId),
  }));
  ipcMain.handle('jam:computeFingerprints', () =>
    jamService.computeLibraryFingerprintsInBackground()
  );
  ipcMain.handle('ffmpeg:status', () => ffmpegService.getStatus());
  ipcMain.handle(
    'ffmpeg:prepareTrack',
    (_evt, trackId: number, forceTranscode?: boolean, analyzeLoudness?: boolean) =>
      ffmpegService.prepareTrack(trackId, Boolean(forceTranscode), Boolean(analyzeLoudness))
  );
  ipcMain.handle(
    'ffmpeg:pretranscodeTrack',
    (_evt, trackId: number, analyzeLoudness?: boolean) =>
      ffmpegService.prepareTrack(trackId, false, Boolean(analyzeLoudness))
  );
  ipcMain.handle('ffmpeg:analyzeLoudness', async (_evt, trackId: number) => ({
    gainDb: await ffmpegService.analyzeTrackLoudness(trackId),
  }));
  ipcMain.handle('ffmpeg:markUnplayable', (_evt, trackId: number) => {
    ffmpegService.markTrackUnplayable(trackId);
  });
  ipcMain.handle('ffmpeg:getCacheStats', () => ffmpegService.getCacheStats());
  ipcMain.handle('ffmpeg:clearCache', () => ffmpegService.clearCache());

  // Unified Cache, Diagnostics & Auto-Update IPC
  ipcMain.handle('caches:getAll', () => ({
    coverCache: libraryService.getCoverCacheStats(),
    lyricsCache: lyricsService.getCacheStats(),
    canvasCache: canvasService.getCacheStats(),
    transcodeCache: ffmpegService.getCacheStats(),
  }));
  ipcMain.handle('caches:clearCover', () => libraryService.clearCoverCache());
  ipcMain.handle('caches:clearLyrics', () => lyricsService.clearCache());
  ipcMain.handle('library:resetUnplayable', () => libraryService.resetUnplayableTracks());
  ipcMain.handle('updater:getStatus', () => updaterService.getStatus());
  ipcMain.handle('updater:setAutoUpdate', (_evt, enabled: boolean) =>
    updaterService.setAutoUpdateEnabled(Boolean(enabled))
  );
  ipcMain.handle('updater:check', () => updaterService.checkForUpdates());
}

// Only one Aestheticy at a time: opening another audio file hands it to the running window.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

pendingOpenFile = findAudioFileInArgs(process.argv.slice(1));

app.on('second-instance', async (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  const file = findAudioFileInArgs(argv.slice(1));
  if (file) {
    const track = await libraryService.ensureFileInLibrary(file).catch(() => null);
    if (track) mainWindow?.webContents.send('app:openFile', track);
  }
});

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;

  if (!startHidden) createSplashWindow();

  await libraryService.initialize();
  registerIpcHandlers();
  createSystemTray();
  registerGlobalShortcuts();

  protocol.handle('aestheticy-media', handleMediaProtocolRequest);

  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
