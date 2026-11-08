# Aestheticy — Liquid Glass Desktop Music Player

**Aestheticy** is a high-performance Windows desktop and hybrid local music player built with **Electron**, **React 19**, **TypeScript**, **Tailwind CSS (Vite)**, **Framer Motion (`motion`)**, **FFmpeg (`ffmpeg-static` / `ffprobe-static`)**, **WebRTC (`simple-peer` / `ws`)**, and **SQLite (`better-sqlite3` / `sql.js`)**.

---

## Key Features

- **Liquid Glass UI & Dynamic Themes**: Frameless Windows Acrylic/Mica-inspired interface with real-time album art palette extraction, three theme surfaces (*Liquid Glass Dark*, *Midnight OLED*, *Obsidian Slate*), and customizable accent colors.
- **High-Capacity Virtualized Library (20,000+ Tracks)**: Non-blocking background folder scanning and chunked SQLite indexing (`libraryService.ts`) with 60fps virtualized song tables and album/artist grids.
- **Universal Audio Engine + FFmpeg Transcoding**: Native HTML5/Web Audio playback with automatic background FFmpeg transcoding for `ALAC`, `APE`, `WV` (WavPack), `WMA`, `AIFF`/`AIF`, `DSF`, and `DFF` (DSD) into a 2 GB LRU disk cache, plus next-track pre-transcoding, EBU R128 (`-14 LUFS`) loudness normalization, gapless preloading, and adjustable crossfade.
- **10-Band Equalizer & Hardware Output Routing**: Web Audio API biquad filter bank (`32Hz–16kHz`) with preamp gain, built-in presets, and output device selection (`setSinkId`).
- **Apple Music–Style Synced Lyrics & Spotify Canvas**: Word-by-word and line-synced lyrics via `lrc.red` / embedded tags / `.lrc` sidecars with per-song timing offset (`±2.0s`), plus looping vertical Canvas video backgrounds cached on disk.
- **Jam Shared Listening (WebRTC P2P)**: Real-time peer-to-peer synchronized listening rooms with 4-character room codes, optional 4-digit PINs, NTP-style median clock synchronization, smooth drift correction (`0.98x–1.02x` playback rate or seek), format-independent track matching (`ISRC`, normalized metadata, or acoustic fingerprint), and optional WebRTC live audio fallback streaming for guests missing a track locally.
- **Resume + History**: Aestheticy remembers the last song *and the exact second* you stopped at (restored paused on next launch), keeps a persistent **Listening History** panel, and both the Queue and History panels have their own **Clear** button.
- **Native Windows Integration**: taskbar thumbnail buttons (Previous / Play-Pause / Next), global media keys plus `Ctrl+Alt+Space / Left / Right`, remembered window size/position/maximized state, single-instance, and "Open with Aestheticy" file associations for all supported audio formats.
- **Smooth Desktop Seeking**: the desktop build streams audio over a custom `aestheticy-media://` protocol with HTTP Range (206) support, so seeking in long FLAC/WAV files is instant.
- **Calm Ambient Background**: Apple Music-style colour fields from the album art drift slowly on their own (pure CSS, no mouse reaction), freezing while paused. *Settings -> Theme -> Visual Effects* offers Full / Balanced (still background) / Lite (no blur) for older PCs.
- **Listening Stats**: a *Listening Stats* page with total listening time (real seconds played), total plays, top songs / artists / albums, and a last-7-days chart. Stored locally in SQLite; *Reset Stats* clears it (separate from clearing History).
- **Sleep Timer**: moon button in the player bar (15 min - 2 h, or end of current track).
- **Windows Behaviour**: optional *Close to system tray* and *Start with Windows* (starts quietly in the tray) in Settings.
- **Text Size & Weight**: Font Scale slider (80-140%) and a Bold Text switch in Settings.
- **Resilient Error Handling**: Clear, non-technical recovery banners and toasts for missing/moved watched folders, corrupted/zero-byte audio files, and offline network state.

---

## Build & Run Instructions

### 1. Prerequisites
- **Node.js** 20+ (LTS recommended) and **npm**
- **Windows 10 / 11 (x64)** for building or running the native NSIS `.exe` installer (`Aestheticy Setup.exe`)

### 2. Install Dependencies
```bash
npm install
```

### 3. Start Hybrid Development Server (Web + Local Backend)
```bash
npm run dev
```
Starts the Express + WebSocket signaling + Vite server on `http://localhost:3000` with SQLite persistence, FFmpeg transcoding, and `chokidar` file watching.

### 4. Run in Native Electron Desktop Mode (Development)
On a local workstation (`electron`, `electron-builder` and `electron-updater` are already in `package.json`, so `npm install` is enough):
```bash
# Terminal 1: Start the Vite + backend server
npm run dev

# Terminal 2: Launch the frameless Electron desktop shell
npm run electron:dev
```

### 5. Build Production Frontend Bundle
```bash
npm run build
```

### 6. Package Windows Installer (`Aestheticy Setup.exe`)

#### Option A: One-Click Automated Batch Script (Recommended on Windows)
Simply double-click **`build-windows.bat`** in the project root (or run it from Command Prompt / PowerShell):
```bat
build-windows.bat
```
`build-windows.bat` automatically:
1. Checks that Node.js is installed
2. Runs `npm install` if `node_modules` is missing
3. Installs `electron`, `electron-builder`, and `electron-updater` if not yet present
4. Builds the React frontend (`dist/`) and compiles the Electron main/preload bundle (`dist-electron/`)
5. Packages **`release\Aestheticy Setup.exe`** (`appId: com.aestheticy.app`) and opens the `release\` folder in Windows Explorer.

*(You can also double-click **`start-dev.bat`** at any time to start the local development server and open the app at `http://localhost:3000`.)*

#### Option B: Manual CLI Commands
Aestheticy is configured via `electron-builder.yml` and `package.json` with:
- **Installer Name**: `Aestheticy Setup.exe` (NSIS installer with custom directory picker and desktop/start-menu shortcuts)
- **App ID**: `com.aestheticy.app`
- **Icons**: `build/icon.ico`, `build/icon.png`, and `build/icon.svg`
- **Auto-Update**: Optional automatic updates via `electron-updater` (configurable in **Settings → Updates**)

To build the Windows x64 installer manually in the `release/` directory:
```bash
# Install Electron packaging tools on your build machine if not already installed
npm install --no-save electron electron-builder electron-updater

# Compile the frontend + Electron main/preload and package "release/Aestheticy Setup.exe"
npm run dist:win
```

To generate an unpacked directory build for testing without running the NSIS installer:
```bash
npm run pack
```

---

## Fonts (Apple Music look)

The UI uses **SF Pro** when it is available, otherwise the bundled **Inter / Inter Display** (SIL OFL, fully offline) - the closest open typeface to Apple Music's font - with Segoe UI / Tahoma as the fallback for Arabic and other scripts. Apple's license does not allow shipping SF Pro itself: install it on the PC, or drop the `.woff2` files into `public/fonts/` (see `public/fonts/README.txt`) and rebuild.

## Known Limitations

1. **WebRTC Peer-to-Peer IP Visibility & Symmetric NATs**:
   - Jam shared listening uses direct WebRTC peer-to-peer data and media channels (`simple-peer`). As noted in the in-app privacy notice, direct P2P connections can expose participant IP addresses to other peers in the same Jam room unless a relay TURN server is configured in **Settings → Jam**.
   - Users behind strict enterprise firewalls or symmetric NATs must configure a valid `turn:` / `turns:` relay server in Settings for P2P connections to succeed across different networks.
2. **DRM-Protected Audio Files**:
   - Encrypted or DRM-locked audio files (such as legacy Protected AAC `.m4p` or encrypted Windows Media `.wma` files) cannot be decoded by FFmpeg. Aestheticy automatically detects that these files cannot be played, displays a friendly notification, and skips to the next track.
3. **DSD (`DSF`/`DFF`) High CPU & Cache Usage**:
   - Direct Stream Digital (`DSF`/`DFF`) tracks are transcoded on-the-fly by FFmpeg into 24-bit/88.2kHz FLAC files inside the 2 GB transcode cache. On older dual-core CPUs, initial playback of multi-hundred-megabyte DSD tracks may show the *"Preparing track..."* indicator for several seconds before playback begins.
4. **Hardware Audio Output Selection (`setSinkId`)**:
   - Selecting a specific hardware output device in **Settings → Audio** relies on the Chromium `HTMLMediaElement.setSinkId()` and `navigator.mediaDevices.enumerateDevices()` APIs. In browser preview environments without microphone/audio-output permission grants, the browser may only list the system default output device.
5. **External Online Providers (`lrc.red` & Spotify Canvas)**:
   - Automatic synced lyrics fetching and Spotify Canvas background videos require an active internet connection and depend on third-party availability. When offline or when a track has no matching external metadata, Aestheticy falls back to embedded ID3/Vorbis lyrics, local `.lrc` sidecar files, and dynamic Liquid Glass album art shaders.
6. **Auto-Update in Unpackaged / Hybrid Mode**:
   - `electron-updater` requires the app to be launched from the installed `Aestheticy Setup.exe` build with a valid release feed (`latest.yml`). When running in development or web hybrid mode (`npm run dev`), update checks report that automatic binary updates are managed by the packaged desktop build.
7. **Unsigned installer**: `Aestheticy Setup.exe` is not code-signed, so Windows SmartScreen shows "Windows protected your PC" the first time. Click *More info -> Run anyway* (or sign the build with your own certificate).
8. **Auto-update feed is a placeholder**: `electron-builder.yml` points `publish` at `github.com/aestheticy/aestheticy-desktop`. Change `owner`/`repo` to your real GitHub repo (or turn Auto-Update off) before expecting update checks to succeed.

---

## Project Structure

```text
aestheticy/
├── build/
│   ├── icon.ico                        # Windows 256x256 application & NSIS installer icon
│   ├── icon.png                        # PNG application icon
│   └── icon.svg                        # Scalable Liquid Glass vector icon
├── electron/
│   ├── assets/                         # Real icon.png + taskbar thumbnail-button icons
│   ├── bootstrapEnv.ts                 # Points data/caches at the per-user userData folder (packaged app)
│   ├── dataDir.ts                      # Single source of truth for the data directory
│   ├── main/
│   │   ├── index.ts                    # Electron Main Process (Frameless window, Tray, IPC handlers)
│   │   ├── db/
│   │   │   └── sqlite.ts               # SQLite database manager (folders, tracks, playlists, settings)
│   │   └── services/
│   │       ├── libraryService.ts       # Background folder scanning, 20k benchmark, tags & cover cache
│   │       ├── playerService.ts        # Playback, EQ, theme, lyrics & output device state persistence
│   │       ├── ffmpegService.ts        # FFmpeg/FFprobe spawning, 2 GB LRU transcode cache & EBU R128
│   │       ├── lyricsService.ts        # Synced lyrics resolution (SQLite, sidecar .lrc, embedded, lrc.red)
│   │       ├── canvasService.ts        # Looping Canvas MP4 cache & provider orchestration
│   │       ├── jamService.ts           # WebSocket signaling & room management for WebRTC Jam sessions
│   │       └── updaterService.ts       # Optional electron-updater integration for com.aestheticy.app
│   └── preload/
│       └── index.ts                    # contextIsolation preload script exposing typed window.aestheticy API
├── src/
│   ├── shared/
│   │   └── ipcTypes.ts                 # Shared TypeScript contracts between Main, Preload, and Renderer
│   ├── services/
│   │   ├── ipcClient.ts                # Unified renderer client (Electron IPC or Express/SSE bridge)
│   │   └── jamWebRtcClient.ts          # WebRTC mesh, NTP median clock sync & drift correction engine
│   ├── components/
│   │   ├── SettingsPage.tsx            # Full Settings page (Folders, Caches, Theme, Audio, EQ, Lyrics, Jam)
│   │   ├── SettingsModal.tsx           # Quick modal for 10-Band EQ, Output Device & Transcode Cache
│   │   ├── JamSidebar.tsx              # Shared listening room controls, NTP stats & shared queue
│   │   ├── LyricsView.tsx              # 60fps Apple Music–style word/line synced lyrics view
│   │   ├── NowPlayingSheet.tsx         # Full-screen Now Playing sheet with Canvas video & quality badges
│   │   ├── VirtualizedTrackList.tsx    # 60fps virtualized song table (tested with 20,000+ songs)
│   │   ├── VirtualizedGrid.tsx         # Virtualized Album & Artist grids
│   │   ├── PlayerBar.tsx               # Dual-deck HTML5 <audio> engine (crossfade, gapless, normalization)
│   │   └── ...
│   └── App.tsx                         # Main application layout, theme orchestration & offline banners
├── electron-builder.yml                # electron-builder configuration for "Aestheticy Setup.exe"
└── server.ts                           # Express + WebSocket + Vite + SSE bridge for hybrid runtime
```

---

## Credits

Developed by **Mido**.


## Liquid glass
Full effects mode uses a real lens refraction (`backdrop-filter: url(#liquid-lens)`, an edge-weighted SVG displacement map in `LiquidRefractionDefs.tsx`) on floating sheets, the player bar and buttons. Balanced keeps blur + specular rims; Lite uses flat translucent surfaces. On older PCs choose Balanced or Lite in Settings > Visual Effects.

## What's new in v6
- **Library browsing:** artist avatar strip (click to filter songs/albums), sort by title/artist/album/year/recently added/length, square / wide / list layouts, and new sidebar categories: Recently Added, Years, Folders, Quality. Artist pages have Albums / Songs tabs.
- **Audio Details:** click the format line in the player bar (or right-click a song → Audio Details) for sample rate, bit depth, channels, bitrate, ReplayGain, tags, encoder and file info.
- **Mini player:** compact Apple-Music-style window docked at the screen edge, draggable, remembers its position.
- **Fonts:** Settings → Theme → Font. Pick a preset, type an installed font name, or add .ttf/.otf/.woff/.woff2 files.
- **Window:** F11 / title-bar button for full screen, window size presets in Settings.
- **Lyrics:** automatic. Local file → cache → MusicBrainz ISRC lookup → lrc.red → LRCLIB (by title/artist/duration), prefetched while a song plays.

## Startup screen & icon
- The splash (`electron/assets/splash.html` + `splash.jpg`) is fully local: the space image fades in, then "Aestheticy" and "by mido" appear as animated glass lettering. It stays up for about 4 seconds so the animation always finishes, then fades out.
- App icon: `build/icon.ico` (16–256 px), `build/icon.png`, and `electron/assets/icon.png` (window + tray) all come from the glass-orb artwork.
