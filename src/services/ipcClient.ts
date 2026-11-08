import type {
  TrackAudioInfo,
  UserFont,
  WindowInfo,
  AestheticyAPI,
  AlbumSummary,
  ArtistSummary,
  DesktopSettings,
  HistoryEntry,
  ListeningStats,
  LibraryEventPayload,
  LibraryStats,
  MusicFolder,
  PersistedPlayerState,
  Playlist,
  Track,
  TrayCommandPayload,
} from '../shared/ipcTypes.ts';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}): ${url}`);
  }
  return res.json() as Promise<T>;
}

function browserWindowInfo(): WindowInfo {
  return {
    isFullScreen: Boolean(document.fullscreenElement),
    isMaximized: false,
    width: window.innerWidth,
    height: window.innerHeight,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  };
}

const trayListeners = new Set<(cmd: TrayCommandPayload) => void>();

const httpBridgeApi: AestheticyAPI = {
  getTracks: (search?: string) => {
    const params = search ? `?search=${encodeURIComponent(search)}` : '';
    return fetchJson<Track[]>(`/api/library/tracks${params}`);
  },
  getAlbums: (search?: string) => {
    const params = search ? `?search=${encodeURIComponent(search)}` : '';
    return fetchJson<AlbumSummary[]>(`/api/library/albums${params}`);
  },
  getArtists: (search?: string) => {
    const params = search ? `?search=${encodeURIComponent(search)}` : '';
    return fetchJson<ArtistSummary[]>(`/api/library/artists${params}`);
  },
  getAlbumTracks: (album: string, artist?: string) => {
    const params = new URLSearchParams({ album });
    if (artist) params.set('artist', artist);
    return fetchJson<Track[]>(`/api/library/album-tracks?${params.toString()}`);
  },
  getArtistTracks: (artist: string) => {
    const params = new URLSearchParams({ artist });
    return fetchJson<Track[]>(`/api/library/artist-tracks?${params.toString()}`);
  },
  getFolders: () => fetchJson<MusicFolder[]>('/api/library/folders'),
  getStats: () => fetchJson<LibraryStats>('/api/library/stats'),
  getAvailableServerFolders: () =>
    fetchJson<{ name: string; path: string; description: string }[]>(
      '/api/library/available-folders'
    ),
  selectAndAddFolder: async () => {
    return { added: false };
  },
  addFolderByPath: (folderPath: string) =>
    fetchJson<{ added: boolean; folder?: MusicFolder; error?: string }>('/api/library/folders', {
      method: 'POST',
      body: JSON.stringify({ folderPath }),
    }),
  uploadBrowserFolderFiles: async (folderName: string, files: FileList | File[]) => {
    const formData = new FormData();
    formData.append('folderName', folderName);
    const fileArray = Array.from(files);
    const relativePaths: string[] = [];

    for (const file of fileArray) {
      formData.append('files', file);
      const relPath = (file as any).webkitRelativePath || file.name;
      relativePaths.push(relPath);
    }
    formData.append('relativePaths', JSON.stringify(relativePaths));

    const res = await fetch('/api/library/upload-folder', {
      method: 'POST',
      body: formData,
    });
    return res.json();
  },
  removeFolder: async (folderId: number) => {
    await fetchJson(`/api/library/folders/${folderId}`, { method: 'DELETE' });
  },
  rescanAllFolders: async () => {
    await fetchJson('/api/library/rescan', { method: 'POST' });
  },

  // Playlists & Favorites
  getPlaylists: () => fetchJson<Playlist[]>('/api/playlists'),
  getPlaylistTracks: (playlistId: number, search?: string) => {
    const params = search ? `?search=${encodeURIComponent(search)}` : '';
    return fetchJson<Track[]>(`/api/playlists/${playlistId}/tracks${params}`);
  },
  createPlaylist: (name: string, description?: string) =>
    fetchJson<Playlist>('/api/playlists', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
  renamePlaylist: (playlistId: number, name: string, description?: string) =>
    fetchJson<Playlist>(`/api/playlists/${playlistId}`, {
      method: 'PUT',
      body: JSON.stringify({ name, description }),
    }),
  deletePlaylist: async (playlistId: number) => {
    await fetchJson(`/api/playlists/${playlistId}`, { method: 'DELETE' });
  },
  addTrackToPlaylist: async (playlistId: number, trackId: number) => {
    await fetchJson(`/api/playlists/${playlistId}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ trackId }),
    });
  },
  removeTrackFromPlaylist: async (playlistId: number, playlistEntryId: number) => {
    await fetchJson(`/api/playlists/${playlistId}/tracks/${playlistEntryId}`, {
      method: 'DELETE',
    });
  },
  reorderPlaylistTracks: async (playlistId: number, orderedEntryIds: number[]) => {
    await fetchJson(`/api/playlists/${playlistId}/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ orderedEntryIds }),
    });
  },
  toggleFavoriteTrack: (trackId: number) =>
    fetchJson<{ isFavorite: boolean }>('/api/playlists/favorites/toggle', {
      method: 'POST',
      body: JSON.stringify({ trackId }),
    }),
  getFavoriteTracks: (search?: string) => {
    const params = search ? `?search=${encodeURIComponent(search)}` : '';
    return fetchJson<Track[]>(`/api/playlists/favorites${params}`);
  },

  // Player & Stream
  getAudioStreamUrl: (track: Track) => `/api/media/stream/${track.id}`,
  getPlayerState: () => fetchJson<PersistedPlayerState>('/api/player/state'),
  savePlayerState: async (state: Partial<PersistedPlayerState>) => {
    await fetchJson('/api/player/state', {
      method: 'POST',
      body: JSON.stringify(state),
    });
  },

  getHistory: (limit?: number) => {
    const params = limit ? `?limit=${limit}` : '';
    return fetchJson<HistoryEntry[]>(`/api/player/history${params}`);
  },
  clearHistory: async () => {
    await fetchJson('/api/player/history/clear', { method: 'POST' });
  },
  getListeningStats: () => fetchJson<ListeningStats>('/api/stats'),
  resetListeningStats: async () => {
    await fetchJson('/api/stats/reset', { method: 'POST' });
  },
  addListenedSeconds: async (trackId: number, seconds: number) => {
    await fetchJson('/api/stats/listened', {
      method: 'POST',
      body: JSON.stringify({ trackId, seconds }),
    });
  },
  recordHistoryEntry: async (trackId: number) => {
    await fetchJson('/api/player/history', {
      method: 'POST',
      body: JSON.stringify({ trackId }),
    });
  },

  // Window, Mini Player & System Tray
  minimizeWindow: async () => {},
  maximizeOrRestoreWindow: async () => ({ isMaximized: false }),
  closeWindow: async () => {},
  setMiniPlayerMode: async () => {},
  getWindowInfo: async () => browserWindowInfo(),
  setFullScreen: async (enabled: boolean) => {
    try {
      if (enabled && !document.fullscreenElement) await document.documentElement.requestFullscreen();
      if (!enabled && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      // ignore
    }
    return browserWindowInfo();
  },
  setWindowSize: async () => browserWindowInfo(),
  getTrackAudioInfo: (trackId: number) =>
    fetchJson<TrackAudioInfo | null>(`/api/library/tracks/${trackId}/audio-info`),
  updateTrayPlaybackState: async () => {},
  onTrayCommand: (callback: (cmd: TrayCommandPayload) => void) => {
    trayListeners.add(callback);
    return () => {
      trayListeners.delete(callback);
    };
  },

  listUserFonts: () => fetchJson<UserFont[]>('/api/fonts'),
  saveUserFont: (fileName: string, dataBase64: string) =>
    fetchJson<UserFont>('/api/fonts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, dataBase64 }),
    }),
  getUserFontData: async (id: string) => {
    const res = await fetchJson<{ data: string | null }>(`/api/fonts/${encodeURIComponent(id)}/data`);
    return res.data;
  },
  deleteUserFont: async (id: string) => {
    await fetchJson(`/api/fonts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  getDesktopSettings: async (): Promise<DesktopSettings> => ({
    isDesktop: false,
    closeToTray: false,
    launchAtStartup: false,
  }),
  setDesktopSettings: async (): Promise<DesktopSettings> => ({
    isDesktop: false,
    closeToTray: false,
    launchAtStartup: false,
  }),
  onOpenFile: () => () => {},
  consumePendingOpenFile: async () => null,

  onLibraryEvent: (callback: (event: LibraryEventPayload) => void) => {
    const source = new EventSource('/api/events');
    source.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data) as LibraryEventPayload;
        callback(parsed);
      } catch {
        // ignore malformed event
      }
    };
    return () => {
      source.close();
    };
  },

  getLyrics: (trackId: number, forceRefresh?: boolean) => {
    const query = forceRefresh ? '?refresh=true' : '';
    return fetchJson(`/api/services/lyrics/${trackId}${query}`);
  },
  saveLyricsOffset: (trackId: number, offset: number) =>
    fetchJson<{ offset: number }>(`/api/services/lyrics/${trackId}/offset`, {
      method: 'POST',
      body: JSON.stringify({ offset }),
    }),
  saveTrackIsrc: (trackId: number, isrcOrUrl: string) =>
    fetchJson(`/api/services/lyrics/${trackId}/isrc`, {
      method: 'POST',
      body: JSON.stringify({ isrcOrUrl }),
    }),
  getCanvasUrl: async (trackId: number) => {
    const res = await fetchJson<any>(`/api/services/canvas/${trackId}`);
    return res?.canvasUrl || null;
  },
  getCanvasForTrack: (trackId: number, forceRefresh?: boolean) => {
    const query = forceRefresh ? '?refresh=true' : '';
    return fetchJson(`/api/services/canvas/${trackId}${query}`);
  },
  linkSpotifyTrackForCanvas: (trackId: number, spotifyInput: string) =>
    fetchJson(`/api/services/canvas/${trackId}/link`, {
      method: 'POST',
      body: JSON.stringify({ spotifyInput }),
    }),
  getCanvasCacheStats: () => fetchJson('/api/services/canvas-cache/stats'),
  clearCanvasCache: () =>
    fetchJson('/api/services/canvas-cache/clear', {
      method: 'POST',
    }),
  getJamStatus: () => fetchJson('/api/services/jam'),
  saveJamRtcConfig: (config) =>
    fetchJson('/api/services/jam/rtc-config', {
      method: 'POST',
      body: JSON.stringify(config),
    }),
  getTrackChromaprint: (trackId: number) =>
    fetchJson(`/api/services/jam/chromaprint/${trackId}`),
  computeLibraryFingerprints: () =>
    fetchJson('/api/services/jam/fingerprints/compute', {
      method: 'POST',
    }),
  getFfmpegStatus: () => fetchJson('/api/services/ffmpeg'),
  prepareTrackPlayback: (trackId: number, forceTranscode?: boolean, analyzeLoudness?: boolean) =>
    fetchJson(`/api/services/ffmpeg/prepare/${trackId}`, {
      method: 'POST',
      body: JSON.stringify({ forceTranscode, analyzeLoudness }),
    }),
  pretranscodeTrack: (trackId: number, analyzeLoudness?: boolean) =>
    fetchJson(`/api/services/ffmpeg/pretranscode/${trackId}`, {
      method: 'POST',
      body: JSON.stringify({ analyzeLoudness }),
    }),
  analyzeTrackLoudness: (trackId: number) =>
    fetchJson<{ gainDb: number }>(`/api/services/ffmpeg/loudness/${trackId}`, {
      method: 'POST',
    }),
  markTrackUnplayable: async (trackId: number, reason?: string) => {
    await fetchJson(`/api/services/ffmpeg/unplayable/${trackId}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },
  getTranscodeCacheStats: () => fetchJson('/api/services/ffmpeg/cache-stats'),
  clearTranscodeCache: () =>
    fetchJson('/api/services/ffmpeg/cache-clear', {
      method: 'POST',
    }),
  getAllCacheStats: () => fetchJson('/api/services/caches/all'),
  clearCoverCache: () =>
    fetchJson('/api/services/caches/cover/clear', {
      method: 'POST',
    }),
  clearLyricsCache: () =>
    fetchJson('/api/services/caches/lyrics/clear', {
      method: 'POST',
    }),
  resetUnplayableTracks: () =>
    fetchJson('/api/library/reset-unplayable', {
      method: 'POST',
    }),
  getUpdateStatus: () => fetchJson('/api/services/updater'),
  setAutoUpdateEnabled: (enabled: boolean) =>
    fetchJson('/api/services/updater/auto-update', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  checkForUpdates: () =>
    fetchJson('/api/services/updater/check', {
      method: 'POST',
    }),
};

export const ipcClient: AestheticyAPI =
  typeof window !== 'undefined' && window.aestheticy ? window.aestheticy : httpBridgeApi;

export const isElectronDesktop = (): boolean =>
  typeof window !== 'undefined' && Boolean(window.aestheticy);
