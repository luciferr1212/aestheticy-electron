import React, { useMemo, useState } from 'react';
import { ArrowLeft, Play, Shuffle, ListPlus, CornerDownRight } from 'lucide-react';
import type { AlbumSummary, Track } from '../shared/ipcTypes.ts';
import { CoverArt } from './CoverArt.tsx';
import { VirtualizedTrackList } from './VirtualizedTrackList.tsx';
import { VirtualizedGrid } from './VirtualizedGrid.tsx';
import { loadPref, savePref, type GridMode } from '../utils/libraryPrefs.ts';
import { formatTotalDurationHuman } from '../utils/formatters.ts';

interface DetailViewProps {
  type: 'album' | 'artist';
  title: string;
  subtitle?: string;
  tracks: Track[];
  currentTrackId: number | null;
  isPlaying: boolean;
  accentColor: string;
  onBack: () => void;
  onPlayTrack: (track: Track, contextTracks: Track[]) => void;
  onTogglePlayPause: () => void;
  onPlayAll: (tracks: Track[], shuffle?: boolean) => void;
  onPlayNext: (track: Track) => void;
  onAddToQueue: (track: Track) => void;
  onAddAllToQueue: (tracks: Track[]) => void;
  onToggleFavorite: (track: Track) => void;
  onOpenContextMenu: (e: React.MouseEvent, track: Track) => void;
  onSelectAlbum?: (album: string, artist: string) => void;
  onSelectArtist?: (artist: string) => void;
}

export const DetailView: React.FC<DetailViewProps> = ({
  type,
  title,
  subtitle,
  tracks,
  currentTrackId,
  isPlaying,
  accentColor,
  onBack,
  onPlayTrack,
  onTogglePlayPause,
  onPlayAll,
  onPlayNext,
  onAddToQueue,
  onAddAllToQueue,
  onToggleFavorite,
  onOpenContextMenu,
  onSelectAlbum,
  onSelectArtist,
}) => {
  const [artistTab, setArtistTab] = useState<'albums' | 'songs'>(() =>
    loadPref<'albums' | 'songs'>('artistTab', ['albums', 'songs'], 'albums')
  );
  const gridMode = loadPref<GridMode>('gridMode', ['square', 'wide', 'list'], 'square');
  const changeTab = (tab: 'albums' | 'songs') => {
    setArtistTab(tab);
    savePref('artistTab', tab);
  };

  const artistAlbums = useMemo<AlbumSummary[]>(() => {
    if (type !== 'artist') return [];
    const map = new Map<string, AlbumSummary>();
    for (const t of tracks) {
      const key = t.album || 'Unknown Album';
      let a = map.get(key);
      if (!a) {
        a = {
          album: key,
          artist: title,
          year: t.year ?? null,
          trackCount: 0,
          totalDuration: 0,
          coverArtUrl: null,
        };
        map.set(key, a);
      }
      a.trackCount += 1;
      a.totalDuration += t.duration || 0;
      if (!a.coverArtUrl && t.coverArtUrl) a.coverArtUrl = t.coverArtUrl;
      if (!a.year && t.year) a.year = t.year;
    }
    return Array.from(map.values()).sort(
      (x, y) => (y.year ?? 0) - (x.year ?? 0) || x.album.localeCompare(y.album)
    );
  }, [tracks, type, title]);

  const coverArtUrl = tracks.find((t) => t.coverArtUrl)?.coverArtUrl ?? null;
  const totalDuration = tracks.reduce((acc, t) => acc + t.duration, 0);
  const year = tracks.find((t) => t.year)?.year ?? null;
  const distinctAlbums = new Set(tracks.map((t) => t.album)).size;

  const headerBanner = (
    <div className="px-6 py-6 bg-white/[0.02] border-b border-white/10">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-white/65 hover:text-white transition-colors mb-4 whitespace-nowrap shrink-0 cursor-pointer"
      >
        <ArrowLeft size={14} />
        <span>Back to {type === 'album' ? 'Albums' : 'Artists'}</span>
      </button>

      <div className="flex flex-col sm:flex-row sm:items-end gap-6">
        <CoverArt
          src={coverArtUrl}
          title={title}
          subtitle={subtitle}
          className="w-36 h-36 rounded-2xl shadow-2xl border border-white/20"
          iconSize={48}
        />

        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-white/60 mb-1">
            {type === 'album' ? 'Album' : 'Artist'}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight truncate">
            {title}
          </h1>

          <div className="flex flex-wrap items-center gap-2 text-xs text-white/65 mt-2 font-mono tabular-nums">
            {type === 'album' && subtitle && (
              <>
                <button
                  type="button"
                  onClick={() => onSelectArtist && onSelectArtist(subtitle)}
                  className="font-sans font-medium text-white hover:underline cursor-pointer"
                >
                  {subtitle}
                </button>
                <span aria-hidden="true">·</span>
              </>
            )}
            {type === 'album' && year && (
              <>
                <span>{year}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            {type === 'artist' && (
              <>
                <span>
                  {distinctAlbums} {distinctAlbums === 1 ? 'album' : 'albums'}
                </span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span>
              {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatTotalDurationHuman(totalDuration)}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 mt-4">
            <button
              type="button"
              disabled={tracks.length === 0}
              onClick={() => onPlayAll(tracks, false)}
              style={{ backgroundColor: accentColor }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl disabled:opacity-40 text-xs font-semibold text-slate-950 shadow-lg hover:brightness-110 transition-all whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play size={14} className="fill-slate-950" />
              <span>Play All</span>
            </button>
            <button
              type="button"
              disabled={tracks.length === 0}
              onClick={() => onPlayAll(tracks, true)}
              className="liquid-glass-btn inline-flex items-center gap-2 px-4 py-2 rounded-xl disabled:opacity-40 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Shuffle size={14} />
              <span>Shuffle</span>
            </button>
            <button
              type="button"
              disabled={tracks.length === 0}
              onClick={() => onAddAllToQueue(tracks)}
              className="liquid-glass-btn inline-flex items-center gap-2 px-3.5 py-2 rounded-xl disabled:opacity-40 text-xs font-medium text-white/85 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ListPlus size={14} />
              <span>Add All to Queue</span>
            </button>
            {tracks.length > 0 && (
              <button
                type="button"
                onClick={() => onPlayNext(tracks[0])}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-white/70 hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <CornerDownRight size={13} />
                <span>Play First Track Next</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {type === 'artist' && (
        <div className="mt-5 inline-flex items-center gap-0.5 rounded-xl bg-black/25 border border-white/10 p-0.5">
          {(['albums', 'songs'] as const).map((tab) => {
            const active = artistTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => changeTab(tab)}
                style={active ? { backgroundColor: accentColor, color: '#090A0F' } : undefined}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  active ? 'shadow' : 'text-white/65 hover:text-white'
                }`}
              >
                {tab === 'albums' ? `Albums (${artistAlbums.length})` : `Songs (${tracks.length})`}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  if (type === 'artist' && artistTab === 'albums') {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {headerBanner}
        <VirtualizedGrid
          mode="albums"
          items={artistAlbums}
          accentColor={accentColor}
          gridMode={gridMode}
          onSelectAlbum={(album, artist) => onSelectAlbum && onSelectAlbum(album, artist)}
          onPlayAlbum={(album) => onPlayAll(tracks.filter((t) => (t.album || 'Unknown Album') === album), false)}
        />
      </div>
    );
  }

  return (
    <VirtualizedTrackList
      tracks={tracks}
      currentTrackId={currentTrackId}
      isPlaying={isPlaying}
      accentColor={accentColor}
      onPlayTrack={onPlayTrack}
      onTogglePlayPause={onTogglePlayPause}
      onPlayNext={onPlayNext}
      onAddToQueue={onAddToQueue}
      onToggleFavorite={onToggleFavorite}
      onOpenContextMenu={onOpenContextMenu}
      onSelectAlbum={onSelectAlbum}
      onSelectArtist={onSelectArtist}
      showAlbumColumn={type === 'artist'}
      headerSlot={headerBanner}
    />
  );
};
