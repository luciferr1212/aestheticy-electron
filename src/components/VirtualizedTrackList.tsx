import React, { useRef, useState, useEffect, useMemo } from 'react';
import {
  Play,
  Pause,
  ListPlus,
  CornerDownRight,
  ArrowUpDown,
  Heart,
  MoreHorizontal,
  AlertTriangle,
  FolderPlus,
  Music,
} from 'lucide-react';
import type { Track } from '../shared/ipcTypes.ts';
import { CoverArt } from './CoverArt.tsx';
import { formatBitrate, formatDuration, isTrackLossless } from '../utils/formatters.ts';

interface VirtualizedTrackListProps {
  tracks: Track[];
  currentTrackId: number | null;
  isPlaying: boolean;
  accentColor: string;
  onPlayTrack: (track: Track, contextTracks: Track[]) => void;
  onTogglePlayPause: () => void;
  onPlayNext: (track: Track) => void;
  onAddToQueue: (track: Track) => void;
  onToggleFavorite: (track: Track) => void;
  onOpenContextMenu: (e: React.MouseEvent, track: Track) => void;
  onSelectAlbum?: (album: string, artist: string) => void;
  onSelectArtist?: (artist: string) => void;
  onAddFolder?: () => void;
  isSearchFiltered?: boolean;
  showAlbumColumn?: boolean;
  headerSlot?: React.ReactNode;
}

type SortField = 'default' | 'title' | 'artist' | 'album' | 'year' | 'duration';
type SortDirection = 'asc' | 'desc';

const ROW_HEIGHT = 44;
const OVERSCAN = 10;

export const VirtualizedTrackList: React.FC<VirtualizedTrackListProps> = ({
  tracks,
  currentTrackId,
  isPlaying,
  accentColor,
  onPlayTrack,
  onTogglePlayPause,
  onPlayNext,
  onAddToQueue,
  onToggleFavorite,
  onOpenContextMenu,
  onSelectAlbum,
  onSelectArtist,
  onAddFolder,
  isSearchFiltered = false,
  showAlbumColumn = true,
  headerSlot,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(640);
  const [headerHeight, setHeaderHeight] = useState(0);
  const headerSlotRef = useRef<HTMLDivElement>(null);

  const [sortField, setSortField] = useState<SortField>('default');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      setViewportHeight(el.clientHeight);
      if (headerSlotRef.current) {
        setHeaderHeight(headerSlotRef.current.offsetHeight);
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    if (headerSlotRef.current) {
      observer.observe(headerSlotRef.current);
    }
    return () => observer.disconnect();
  }, [headerSlot]);

  const sortedTracks = useMemo(() => {
    if (sortField === 'default') return tracks;
    const copy = [...tracks];
    const mult = sortDir === 'asc' ? 1 : -1;

    copy.sort((a, b) => {
      switch (sortField) {
        case 'title':
          return a.title.localeCompare(b.title) * mult;
        case 'artist':
          return a.artist.localeCompare(b.artist) * mult;
        case 'album':
          return a.album.localeCompare(b.album) * mult;
        case 'year':
          return ((a.year || 0) - (b.year || 0)) * mult;
        case 'duration':
          return (a.duration - b.duration) * mult;
        default:
          return 0;
      }
    });
    return copy;
  }, [tracks, sortField, sortDir]);

  const handleSortClick = (field: SortField) => {
    if (sortField === field) {
      if (sortDir === 'asc') {
        setSortDir('desc');
      } else {
        setSortField('default');
        setSortDir('asc');
      }
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const effectiveScrollTop = Math.max(0, scrollTop - headerHeight);
  const totalHeight = sortedTracks.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(effectiveScrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const endIndex = Math.min(sortedTracks.length, startIndex + visibleCount);
  const visibleTracks = sortedTracks.slice(startIndex, endIndex);

  if (sortedTracks.length === 0) {
    return (
      <div className="flex-1 h-full overflow-y-auto overflow-x-hidden flex flex-col">
        {headerSlot && <div ref={headerSlotRef}>{headerSlot}</div>}
        <div className="flex-1 flex flex-col items-center justify-center py-20 px-6 text-center">
          <div className="w-14 h-14 rounded-2xl liquid-glass-elevated flex items-center justify-center mb-4">
            <Music size={24} style={{ color: accentColor }} />
          </div>
          <h3 className="text-base font-bold text-white font-display">
            {isSearchFiltered ? 'No matching songs found' : 'Your music library is empty'}
          </h3>
          <p className="text-xs text-white/60 mt-1.5 max-w-md leading-relaxed">
            {isSearchFiltered
              ? 'Try clearing your search query or add another music folder from your computer.'
              : 'Add a music folder from your computer to browse your songs, artwork, and synced lyrics.'}
          </p>
          {onAddFolder && (
            <button
              type="button"
              onClick={onAddFolder}
              style={{ backgroundColor: accentColor }}
              className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-slate-950 hover:opacity-95 transition-opacity shadow-lg cursor-pointer whitespace-nowrap shrink-0"
            >
              <FolderPlus size={15} />
              <span>Add music folder</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="flex-1 h-full overflow-y-auto overflow-x-hidden relative"
    >
      {headerSlot && <div ref={headerSlotRef}>{headerSlot}</div>}

      {/* Sticky Liquid Glass Table Column Header */}
      <div className="sticky top-0 z-10 grid grid-cols-[44px_minmax(200px,2.2fr)_minmax(130px,1.3fr)_minmax(130px,1.3fr)_175px_112px] items-center h-9 px-5 bg-[#090A10]/85 backdrop-blur-md border-b border-white/10 text-xs font-medium text-white/55">
        <div className="font-mono tabular-nums text-right pr-3">#</div>
        <button
          type="button"
          onClick={() => handleSortClick('title')}
          className="flex items-center gap-1.5 text-left hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <span>Title</span>
          {sortField === 'title' && <ArrowUpDown size={12} style={{ color: accentColor }} />}
        </button>
        <button
          type="button"
          onClick={() => handleSortClick('artist')}
          className="flex items-center gap-1.5 text-left hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <span>Artist</span>
          {sortField === 'artist' && <ArrowUpDown size={12} style={{ color: accentColor }} />}
        </button>
        {showAlbumColumn ? (
          <button
            type="button"
            onClick={() => handleSortClick('album')}
            className="flex items-center gap-1.5 text-left hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Album</span>
            {sortField === 'album' && <ArrowUpDown size={12} style={{ color: accentColor }} />}
          </button>
        ) : (
          <div className="text-left">Album</div>
        )}
        <button
          type="button"
          onClick={() => handleSortClick('year')}
          className="flex items-center gap-1.5 text-left hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <span>Year · Format · Quality</span>
          {sortField === 'year' && <ArrowUpDown size={12} style={{ color: accentColor }} />}
        </button>
        <button
          type="button"
          onClick={() => handleSortClick('duration')}
          className="flex items-center justify-end gap-1.5 text-right hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <span>Time</span>
          {sortField === 'duration' && <ArrowUpDown size={12} style={{ color: accentColor }} />}
        </button>
      </div>

      {/* Virtualized Canvas */}
      <div className="relative w-full" style={{ height: `${totalHeight}px` }}>
          {visibleTracks.map((track, idx) => {
            const absoluteIndex = startIndex + idx;
            const isCurrent = track.id === currentTrackId;
            const topOffset = absoluteIndex * ROW_HEIGHT;
            const lossless = isTrackLossless(track);
            const bitrateStr = formatBitrate(track.bitrate);

            return (
              <div
                key={track.id}
                style={{
                  transform: `translateY(${topOffset}px)`,
                  height: `${ROW_HEIGHT}px`,
                }}
                onDoubleClick={() => onPlayTrack(track, sortedTracks)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onOpenContextMenu(e, track);
                }}
                className={`group absolute left-0 right-0 grid grid-cols-[44px_minmax(200px,2.2fr)_minmax(130px,1.3fr)_minmax(130px,1.3fr)_175px_112px] items-center px-5 border-b border-white/[0.05] text-[13px] transition-colors duration-150 ${
                  track.unplayable
                    ? 'opacity-50 bg-rose-950/10 text-white/50'
                    : isCurrent
                    ? 'bg-white/[0.11] text-white'
                    : 'hover:bg-white/[0.05] text-white/90'
                }`}
              >
                {/* Track Number / Play Trigger */}
                <div className="flex items-center justify-end pr-3">
                  {track.unplayable ? (
                    <span title="Unplayable audio file" className="text-rose-400">
                      <AlertTriangle size={13} />
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (isCurrent) {
                          onTogglePlayPause();
                        } else {
                          onPlayTrack(track, sortedTracks);
                        }
                      }}
                      title={isCurrent && isPlaying ? 'Pause' : 'Play'}
                      className="w-6 h-6 flex items-center justify-center rounded text-white/60 hover:text-white cursor-pointer"
                    >
                      {isCurrent ? (
                        isPlaying ? (
                          <Pause size={14} style={{ color: accentColor }} className="fill-current" />
                        ) : (
                          <Play size={14} style={{ color: accentColor }} className="fill-current" />
                        )
                      ) : (
                        <>
                          <span className="font-mono tabular-nums text-xs text-white/50 group-hover:hidden">
                            {track.trackNumber ?? absoluteIndex + 1}
                          </span>
                          <Play
                            size={13}
                            className="hidden group-hover:block text-white fill-white"
                          />
                        </>
                      )}
                    </button>
                  )}
                </div>

                {/* Cover Art + Title */}
                <div className="flex items-center gap-3 min-w-0 pr-3">
                  <CoverArt
                    src={track.coverArtUrl}
                    title={track.album}
                    subtitle={track.artist}
                    className="w-7 h-7 rounded-md"
                    iconSize={14}
                  />
                  <button
                    type="button"
                    onClick={() => onPlayTrack(track, sortedTracks)}
                    style={{ color: isCurrent ? accentColor : undefined }}
                    className="truncate font-medium text-left text-white cursor-pointer"
                  >
                    {track.title}
                  </button>
                  {track.unplayable && (
                    <span className="text-[11px] font-mono text-rose-400 shrink-0">
                      Unplayable
                    </span>
                  )}
                </div>

                {/* Artist */}
                <div className="min-w-0 pr-3">
                  {onSelectArtist ? (
                    <button
                      type="button"
                      onClick={() => onSelectArtist(track.artist)}
                      className="truncate block max-w-full text-left text-white/65 hover:text-white hover:underline transition-colors cursor-pointer"
                    >
                      {track.artist}
                    </button>
                  ) : (
                    <span className="truncate block text-white/65">{track.artist}</span>
                  )}
                </div>

                {/* Album */}
                <div className="min-w-0 pr-3">
                  {showAlbumColumn && onSelectAlbum ? (
                    <button
                      type="button"
                      onClick={() => onSelectAlbum(track.album, track.artist)}
                      className="truncate block max-w-full text-left text-white/65 hover:text-white hover:underline transition-colors cursor-pointer"
                    >
                      {track.album}
                    </button>
                  ) : (
                    <span className="truncate block text-white/55">{track.album}</span>
                  )}
                </div>

                {/* Unboxed Metadata: Year · Format · Lossless / Bitrate */}
                <div className="flex items-center gap-1.5 text-xs text-white/55 font-mono tabular-nums truncate pr-2">
                  <span>{track.year ?? '—'}</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-white/80 font-medium">{track.format}</span>
                  {lossless && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-white/60">Lossless</span>
                    </>
                  )}
                  {!lossless && bitrateStr && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-white/45">{bitrateStr}</span>
                    </>
                  )}
                </div>

                {/* Favorite + Hover Queue / Context Menu Actions + Duration */}
                <div className="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(track);
                    }}
                    title={track.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                    className={`p-1 rounded hover:bg-white/10 transition-colors cursor-pointer ${
                      track.isFavorite
                        ? 'text-rose-400 opacity-100'
                        : 'text-white/45 opacity-0 group-hover:opacity-100 hover:text-white'
                    }`}
                  >
                    <Heart size={13} className={track.isFavorite ? 'fill-rose-400' : ''} />
                  </button>

                  <div className="hidden group-hover:flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlayNext(track);
                      }}
                      title="Play Next"
                      className="p-1 rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
                    >
                      <CornerDownRight size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddToQueue(track);
                      }}
                      title="Add to Queue"
                      className="p-1 rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
                    >
                      <ListPlus size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenContextMenu(e, track);
                      }}
                      title="Add to Playlist & More..."
                      className="p-1 rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                  <span className="font-mono tabular-nums text-xs text-white/60 w-10 text-right group-hover:hidden">
                    {formatDuration(track.duration)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
    </div>
  );
};
