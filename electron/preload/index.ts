import { contextBridge, ipcRenderer } from 'electron';
import type {
  AestheticyAPI,
  LibraryEventPayload,
  PersistedPlayerState,
  Track,
  TrayCommandPayload,
} from '../../src/shared/ipcTypes.ts';

// ffmpegService returns web-bridge style URLs (/api/media/stream/<id>?transcoded=1).
// In the desktop build those are rewritten to the aestheticy-media:// protocol, which
// supports HTTP Range requests (206) for smooth seeking.
const toDesktopStreamUrl = (url: string | null | undefined): string | null | undefined =>
  typeof url === 'string'
    ? url.replace(/^\/api\/media\/stream\/(\d+)/, 'aestheticy-media://track/$1')
    : url;

const withDesktopStreamUrl = async (promise: Promise<any>): Promise<any> => {
  const result = await promise;
  return result && typeof result === 'object' && 'streamUrl' in result
    ? { ...result, streamUrl: toDesktopStreamUrl(result.streamUrl) }
    : result;
};

const aestheticyPreloadApi: AestheticyAPI = {
  getTracks: (search?: string) => ipcRenderer.invoke('library:getTracks', search),
  getAlbums: (search?: string) => ipcRenderer.invoke('library:getAlbums', search),
  getArtists: (search?: string) => ipcRenderer.invoke('library:getArtists', search),
  getAlbumTracks: (album: string, artist?: string) =>
    ipcRenderer.invoke('library:getAlbumTracks', album, artist),
  getArtistTracks: (artist: string) => ipcRenderer.invoke('library:getArtistTracks', artist),
  getFolders: () => ipcRenderer.invoke('library:getFolders'),
  getStats: () => ipcRenderer.invoke('library:getStats'),
  selectAndAddFolder: () => ipcRenderer.invoke('library:selectAndAddFolder'),
  addFolderByPath: (folderPath: string) => ipcRenderer.invoke('library:addFolderByPath', folderPath),
  uploadBrowserFolderFiles: async () => ({
    added: false,
    error: 'Use native folder dialog in Electron desktop mode',
  }),
  removeFolder: (folderId: number) => ipcRenderer.invoke('library:removeFolder', folderId),
  rescanAllFolders: () => ipcRenderer.invoke('library:rescanAllFolders'),
  getAvailableServerFolders: () => ipcRenderer.invoke('library:getAvailableServerFolders'),

  // Playlists & Favorites
  getPlaylists: () => ipcRenderer.invoke('playlists:getAll'),
  getPlaylistTracks: (playlistId: number, search?: string) =>
    ipcRenderer.invoke('playlists:getTracks', playlistId, search),
  createPlaylist: (name: string, description?: string) =>
    ipcRenderer.invoke('playlists:create', name, description),
  renamePlaylist: (playlistId: number, name: string, description?: string) =>
    ipcRenderer.invoke('playlists:rename', playlistId, name, description),
  deletePlaylist: (playlistId: number) => ipcRenderer.invoke('playlists:delete', playlistId),
  addTrackToPlaylist: (playlistId: number, trackId: number) =>
    ipcRenderer.invoke('playlists:addTrack', playlistId, trackId),
  removeTrackFromPlaylist: (playlistId: number, playlistEntryId: number) =>
    ipcRenderer.invoke('playlists:removeTrack', playlistId, playlistEntryId),
  reorderPlaylistTracks: (playlistId: number, orderedEntryIds: number[]) =>
    ipcRenderer.invoke('playlists:reorder', playlistId, orderedEntryIds),
  toggleFavoriteTrack: (trackId: number) =>
    ipcRenderer.invoke('playlists:toggleFavorite', trackId),
  getFavoriteTracks: (search?: string) => ipcRenderer.invoke('playlists:getFavorites', search),

  // Player & Stream
  getAudioStreamUrl: (track: Track) => `aestheticy-media://track/${track.id}`,
  getPlayerState: () => ipcRenderer.invoke('player:getState'),
  savePlayerState: (state: Partial<PersistedPlayerState>) =>
    ipcRenderer.invoke('player:saveState', state),

  getHistory: (limit?: number) => ipcRenderer.invoke('player:getHistory', limit),
  clearHistory: () => ipcRenderer.invoke('player:clearHistory'),
  recordHistoryEntry: (trackId: number) => ipcRenderer.invoke('player:recordHistory', trackId),

  getListeningStats: () => ipcRenderer.invoke('stats:get'),
  resetListeningStats: () => ipcRenderer.invoke('stats:reset'),
  addListenedSeconds: (trackId: number, seconds: number) =>
    ipcRenderer.invoke('stats:addListened', trackId, seconds),

  // Window, Mini Player & System Tray
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeOrRestoreWindow: () => ipcRenderer.invoke('window:maximizeOrRestore'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  setMiniPlayerMode: (enabled: boolean) => ipcRenderer.invoke('window:setMiniPlayer', enabled),
  getWindowInfo: () => ipcRenderer.invoke('window:getInfo'),
  setFullScreen: (enabled: boolean) => ipcRenderer.invoke('window:setFullScreen', enabled),
  setWindowSize: (width: number, height: number) =>
    ipcRenderer.invoke('window:setSize', width, height),
  getTrackAudioInfo: (trackId: number) => ipcRenderer.invoke('library:getTrackAudioInfo', trackId),
  updateTrayPlaybackState: (state: { title: string; artist: string; isPlaying: boolean }) =>
    ipcRenderer.invoke('tray:updatePlaybackState', state),
  onTrayCommand: (callback: (cmd: TrayCommandPayload) => void) => {
    const listener = (_event: any, payload: TrayCommandPayload) => callback(payload);
    ipcRenderer.on('tray:command', listener);
    return () => {
      ipcRenderer.removeListener('tray:command', listener);
    };
  },

  listUserFonts: () => ipcRenderer.invoke('fonts:list'),
  saveUserFont: (fileName: string, dataBase64: string) =>
    ipcRenderer.invoke('fonts:save', fileName, dataBase64),
  getUserFontData: (id: string) => ipcRenderer.invoke('fonts:getData', id),
  deleteUserFont: (id: string) => ipcRenderer.invoke('fonts:delete', id),

  getDesktopSettings: () => ipcRenderer.invoke('app:getDesktopSettings'),
  setDesktopSettings: (patch) => ipcRenderer.invoke('app:setDesktopSettings', patch),

  onOpenFile: (callback: (track: Track) => void) => {
    const listener = (_event: any, track: Track) => callback(track);
    ipcRenderer.on('app:openFile', listener);
    return () => {
      ipcRenderer.removeListener('app:openFile', listener);
    };
  },
  consumePendingOpenFile: () => ipcRenderer.invoke('app:consumePendingOpenFile'),

  onLibraryEvent: (callback: (event: LibraryEventPayload) => void) => {
    const listener = (_event: any, payload: LibraryEventPayload) => callback(payload);
    ipcRenderer.on('library:event', listener);
    return () => {
      ipcRenderer.removeListener('library:event', listener);
    };
  },

  getLyrics: (trackId: number, forceRefresh?: boolean) =>
    ipcRenderer.invoke('lyrics:get', trackId, forceRefresh),
  saveLyricsOffset: (trackId: number, offset: number) =>
    ipcRenderer.invoke('lyrics:saveOffset', trackId, offset),
  saveTrackIsrc: (trackId: number, isrcOrUrl: string) =>
    ipcRenderer.invoke('lyrics:saveIsrc', trackId, isrcOrUrl),
  getCanvasUrl: (trackId: number) => ipcRenderer.invoke('canvas:get', trackId),
  getCanvasForTrack: (trackId: number, forceRefresh?: boolean) =>
    ipcRenderer.invoke('canvas:getForTrack', trackId, forceRefresh),
  linkSpotifyTrackForCanvas: (trackId: number, spotifyInput: string) =>
    ipcRenderer.invoke('canvas:linkSpotifyTrack', trackId, spotifyInput),
  getCanvasCacheStats: () => ipcRenderer.invoke('canvas:getCacheStats'),
  clearCanvasCache: () => ipcRenderer.invoke('canvas:clearCache'),
  getJamStatus: () => ipcRenderer.invoke('jam:status'),
  saveJamRtcConfig: (config) => ipcRenderer.invoke('jam:saveRtcConfig', config),
  getTrackChromaprint: (trackId: number) => ipcRenderer.invoke('jam:getChromaprint', trackId),
  computeLibraryFingerprints: () => ipcRenderer.invoke('jam:computeFingerprints'),
  getFfmpegStatus: () => ipcRenderer.invoke('ffmpeg:status'),
  prepareTrackPlayback: (trackId: number, forceTranscode?: boolean, analyzeLoudness?: boolean) =>
    withDesktopStreamUrl(
      ipcRenderer.invoke('ffmpeg:prepareTrack', trackId, forceTranscode, analyzeLoudness)
    ),
  pretranscodeTrack: (trackId: number, analyzeLoudness?: boolean) =>
    withDesktopStreamUrl(ipcRenderer.invoke('ffmpeg:pretranscodeTrack', trackId, analyzeLoudness)),
  analyzeTrackLoudness: (trackId: number) =>
    ipcRenderer.invoke('ffmpeg:analyzeLoudness', trackId),
  markTrackUnplayable: (trackId: number, reason?: string) =>
    ipcRenderer.invoke('ffmpeg:markUnplayable', trackId, reason),
  getTranscodeCacheStats: () => ipcRenderer.invoke('ffmpeg:getCacheStats'),
  clearTranscodeCache: () => ipcRenderer.invoke('ffmpeg:clearCache'),
  getAllCacheStats: () => ipcRenderer.invoke('caches:getAll'),
  clearCoverCache: () => ipcRenderer.invoke('caches:clearCover'),
  clearLyricsCache: () => ipcRenderer.invoke('caches:clearLyrics'),
  resetUnplayableTracks: () => ipcRenderer.invoke('library:resetUnplayable'),
  getUpdateStatus: () => ipcRenderer.invoke('updater:getStatus'),
  setAutoUpdateEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('updater:setAutoUpdate', enabled),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
};

contextBridge.exposeInMainWorld('aestheticy', aestheticyPreloadApi);
