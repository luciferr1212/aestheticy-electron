import React, { useRef, useState, useEffect } from 'react';
import { Play, FolderPlus, Disc, Users } from 'lucide-react';
import type { AlbumSummary, ArtistSummary } from '../shared/ipcTypes.ts';
import { CoverArt } from './CoverArt.tsx';
import { formatTotalDurationHuman } from '../utils/formatters.ts';
import type { GridMode } from '../utils/libraryPrefs.ts';

interface VirtualizedAlbumsGridProps {
  mode: 'albums';
  items: AlbumSummary[];
  accentColor: string;
  onSelectAlbum: (album: string, artist: string) => void;
  onPlayAlbum: (album: string, artist: string) => void;
  onAddFolder?: () => void;
  isSearchFiltered?: boolean;
  gridMode?: GridMode;
}

interface VirtualizedArtistsGridProps {
  mode: 'artists';
  items: ArtistSummary[];
  accentColor: string;
  onSelectArtist: (artist: string) => void;
  onPlayArtist: (artist: string) => void;
  onAddFolder?: () => void;
  isSearchFiltered?: boolean;
  gridMode?: GridMode;
}

type VirtualizedGridProps = VirtualizedAlbumsGridProps | VirtualizedArtistsGridProps;

const LAYOUTS: Record<GridMode, { rowHeight: number; minWidth: number; gapClass: string }> = {
  square: { rowHeight: 256, minWidth: 192, gapClass: 'gap-5 pb-4' },
  wide: { rowHeight: 116, minWidth: 330, gapClass: 'gap-4 pb-3' },
  list: { rowHeight: 60, minWidth: 100000, gapClass: 'gap-0 pb-1' },
};

export const VirtualizedGrid: React.FC<VirtualizedGridProps> = (props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(960);
  const [viewportHeight, setViewportHeight] = useState(640);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateDimensions = () => {
      setViewportWidth(el.clientWidth);
      setViewportHeight(el.clientHeight);
    };
    updateDimensions();

    const observer = new ResizeObserver(updateDimensions);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const mode: GridMode = props.gridMode ?? 'square';
  const layout = LAYOUTS[mode];
  const CARD_ROW_HEIGHT = layout.rowHeight;
  const usableWidth = Math.max(320, viewportWidth - 48);
  const columns =
    mode === 'list' ? 1 : Math.max(mode === 'wide' ? 1 : 2, Math.floor(usableWidth / layout.minWidth));
  const totalItems = props.items.length;
  const totalRows = Math.ceil(totalItems / columns);
  const totalHeight = totalRows * CARD_ROW_HEIGHT;

  const overscanRows = 2;
  const startRow = Math.max(0, Math.floor(scrollTop / CARD_ROW_HEIGHT) - overscanRows);
  const visibleRows = Math.ceil(viewportHeight / CARD_ROW_HEIGHT) + overscanRows * 2;
  const endRow = Math.min(totalRows, startRow + visibleRows);

  if (totalItems === 0) {
    const isAlbums = props.mode === 'albums';
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="w-14 h-14 rounded-2xl liquid-glass-elevated flex items-center justify-center mb-4">
          {isAlbums ? (
            <Disc size={24} style={{ color: props.accentColor }} />
          ) : (
            <Users size={24} style={{ color: props.accentColor }} />
          )}
        </div>
        <h3 className="text-base font-bold text-white font-display">
          {props.isSearchFiltered
            ? `No matching ${isAlbums ? 'albums' : 'artists'} found`
            : `No ${isAlbums ? 'albums' : 'artists'} in your library yet`}
        </h3>
        <p className="text-xs text-white/60 mt-1.5 max-w-md leading-relaxed">
          {props.isSearchFiltered
            ? 'Try adjusting your search query or add another music folder from your computer.'
            : isAlbums
            ? 'Add a music folder from your computer and Aestheticy will automatically group your songs into albums with artwork.'
            : 'Add a music folder from your computer to browse all artists and their discographies.'}
        </p>
        {props.onAddFolder && (
          <button
            type="button"
            onClick={props.onAddFolder}
            style={{ backgroundColor: props.accentColor }}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-slate-950 hover:opacity-95 transition-opacity shadow-lg cursor-pointer whitespace-nowrap shrink-0"
          >
            <FolderPlus size={15} />
            <span>Add music folder</span>
          </button>
        )}
      </div>
    );
  }

  const rowsToRender: number[] = [];
  for (let r = startRow; r < endRow; r++) {
    rowsToRender.push(r);
  }

  return (
    <div
      ref={containerRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="flex-1 h-full overflow-y-auto overflow-x-hidden px-6 py-5"
    >
      <div className="relative w-full" style={{ height: `${totalHeight}px` }}>
        {rowsToRender.map((rowIndex) => {
          const sliceStart = rowIndex * columns;
          const rowItems = props.items.slice(sliceStart, sliceStart + columns);

          return (
            <div
              key={rowIndex}
              style={{
                transform: `translateY(${rowIndex * CARD_ROW_HEIGHT}px)`,
                height: `${CARD_ROW_HEIGHT}px`,
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              }}
              className={`absolute left-0 right-0 grid ${layout.gapClass}`}
            >
              {rowItems.map((item) => {
                if (mode !== 'square') {
                  const isAlbum = props.mode === 'albums';
                  const album = item as AlbumSummary;
                  const artist = item as ArtistSummary;
                  const key = isAlbum ? `${album.album}::${album.artist}` : artist.artist;
                  const title = isAlbum ? album.album : artist.artist;
                  const sub = isAlbum
                    ? album.artist
                    : `${artist.albumCount} ${artist.albumCount === 1 ? 'album' : 'albums'}`;
                  const meta = isAlbum
                    ? `${album.year ? `${album.year} · ` : ''}${album.trackCount} ${
                        album.trackCount === 1 ? 'song' : 'songs'
                      } · ${formatTotalDurationHuman(album.totalDuration)}`
                    : `${artist.trackCount} ${artist.trackCount === 1 ? 'song' : 'songs'} · ${formatTotalDurationHuman(
                        artist.totalDuration
                      )}`;
                  const cover = isAlbum ? album.coverArtUrl : artist.coverArtUrl;
                  const isList = mode === 'list';
                  const artSize = isList ? 'w-11 h-11' : 'w-[88px] h-[88px]';
                  return (
                    <div
                      key={key}
                      onClick={() =>
                        props.mode === 'albums'
                          ? props.onSelectAlbum(album.album, album.artist)
                          : props.onSelectArtist(artist.artist)
                      }
                      className={`group flex items-center gap-3.5 cursor-pointer transition-all duration-150 ${
                        isList
                          ? 'px-3 py-1.5 rounded-xl hover:bg-white/[0.07]'
                          : 'p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/12 hover:border-white/25 shadow-lg'
                      }`}
                    >
                      <div className={`relative shrink-0 overflow-hidden ${artSize} ${isAlbum ? 'rounded-lg' : 'rounded-full'}`}>
                        <CoverArt
                          src={cover}
                          title={title}
                          subtitle={isAlbum ? album.artist : undefined}
                          className={`w-full h-full ${isAlbum ? 'rounded-lg' : 'rounded-full'}`}
                          iconSize={isList ? 16 : 28}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-white truncate">{title}</h3>
                        <p className="text-xs text-white/65 truncate mt-0.5">{sub}</p>
                        <p className="text-[11px] text-white/45 font-mono tabular-nums truncate mt-0.5">{meta}</p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (props.mode === 'albums') props.onPlayAlbum(album.album, album.artist);
                          else props.onPlayArtist(artist.artist);
                        }}
                        title={`Play ${title}`}
                        style={{ backgroundColor: props.accentColor }}
                        className="shrink-0 w-8 h-8 rounded-full text-slate-950 shadow-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:scale-105 cursor-pointer"
                      >
                        <Play size={14} className="fill-slate-950 ml-0.5" />
                      </button>
                    </div>
                  );
                }
                if (props.mode === 'albums') {
                  const album = item as AlbumSummary;
                  return (
                    <div
                      key={`${album.album}::${album.artist}`}
                      onClick={() => props.onSelectAlbum(album.album, album.artist)}
                      className="group flex flex-col p-3.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/12 hover:border-white/25 shadow-lg transition-all duration-150 cursor-pointer"
                    >
                      <div className="relative w-full aspect-square mb-3 overflow-hidden rounded-xl">
                        <CoverArt
                          src={album.coverArtUrl}
                          title={album.album}
                          subtitle={album.artist}
                          className="w-full h-full rounded-xl"
                          iconSize={36}
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            props.onPlayAlbum(album.album, album.artist);
                          }}
                          title={`Play ${album.album}`}
                          style={{ backgroundColor: props.accentColor }}
                          className="absolute bottom-2.5 right-2.5 w-9 h-9 rounded-full text-slate-950 shadow-xl flex items-center justify-center opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150 hover:scale-105 cursor-pointer"
                        >
                          <Play size={16} className="fill-slate-950 ml-0.5" />
                        </button>
                      </div>
                      <h3 className="text-sm font-semibold text-white truncate">
                        {album.album}
                      </h3>
                      <p className="text-xs text-white/65 truncate mt-0.5">{album.artist}</p>
                      <div className="flex items-center gap-1.5 text-[11px] text-white/50 font-mono tabular-nums mt-1.5 truncate">
                        {album.year && (
                          <>
                            <span>{album.year}</span>
                            <span aria-hidden="true">·</span>
                          </>
                        )}
                        <span>
                          {album.trackCount} {album.trackCount === 1 ? 'song' : 'songs'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{formatTotalDurationHuman(album.totalDuration)}</span>
                      </div>
                    </div>
                  );
                } else {
                  const artist = item as ArtistSummary;
                  return (
                    <div
                      key={artist.artist}
                      onClick={() => props.onSelectArtist(artist.artist)}
                      className="group flex flex-col p-3.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/12 hover:border-white/25 shadow-lg transition-all duration-150 cursor-pointer"
                    >
                      <div className="relative w-full aspect-square mb-3 overflow-hidden rounded-xl">
                        <CoverArt
                          src={artist.coverArtUrl}
                          title={artist.artist}
                          className="w-full h-full rounded-xl"
                          iconSize={36}
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            props.onPlayArtist(artist.artist);
                          }}
                          title={`Play ${artist.artist}`}
                          style={{ backgroundColor: props.accentColor }}
                          className="absolute bottom-2.5 right-2.5 w-9 h-9 rounded-full text-slate-950 shadow-xl flex items-center justify-center opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150 hover:scale-105 cursor-pointer"
                        >
                          <Play size={16} className="fill-slate-950 ml-0.5" />
                        </button>
                      </div>
                      <h3 className="text-sm font-semibold text-white truncate">
                        {artist.artist}
                      </h3>
                      <div className="flex items-center gap-1.5 text-[11px] text-white/55 font-mono tabular-nums mt-1 truncate">
                        <span>
                          {artist.albumCount} {artist.albumCount === 1 ? 'album' : 'albums'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {artist.trackCount} {artist.trackCount === 1 ? 'song' : 'songs'}
                        </span>
                      </div>
                      <p className="text-[11px] text-white/45 font-mono tabular-nums mt-0.5 truncate">
                        {formatTotalDurationHuman(artist.totalDuration)}
                      </p>
                    </div>
                  );
                }
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
