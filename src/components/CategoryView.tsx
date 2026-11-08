import React, { useMemo } from 'react';
import { ArrowLeft, Play, Shuffle, CalendarDays, Folder, Gem } from 'lucide-react';
import type { Track } from '../shared/ipcTypes.ts';
import { CoverArt } from './CoverArt.tsx';
import { formatTotalDurationHuman } from '../utils/formatters.ts';
import {
  buildCategoryGroups,
  compareText,
  type CategoryGroup,
  type CategoryKind,
  type GridMode,
  type SortDir,
} from '../utils/libraryPrefs.ts';

interface CategoryViewProps {
  kind: CategoryKind;
  tracks: Track[];
  accentColor: string;
  gridMode: GridMode;
  sortDir: SortDir;
  selectedKey: string | null;
  onSelectKey: (key: string | null) => void;
  onPlayTracks: (tracks: Track[], shuffle: boolean) => void;
  renderTrackList: (tracks: Track[], headerSlot: React.ReactNode) => React.ReactNode;
}

const KIND_META: Record<CategoryKind, { title: string; Icon: typeof Folder; empty: string }> = {
  years: { title: 'Years', Icon: CalendarDays, empty: 'No songs with a release year yet.' },
  folders: { title: 'Folders', Icon: Folder, empty: 'No folders yet. Add a music folder first.' },
  quality: { title: 'Quality', Icon: Gem, empty: 'No songs yet.' },
};

export const CategoryView: React.FC<CategoryViewProps> = ({
  kind,
  tracks,
  accentColor,
  gridMode,
  sortDir,
  selectedKey,
  onSelectKey,
  onPlayTracks,
  renderTrackList,
}) => {
  const meta = KIND_META[kind];

  const groups = useMemo(() => {
    const base = buildCategoryGroups(kind, tracks);
    if (kind === 'folders') {
      return sortDir === 'asc'
        ? base
        : [...base].sort((a, b) => compareText(b.label, a.label));
    }
    if (kind === 'years') {
      // Years are newest-first by default ("desc"); ascending flips to oldest-first.
      return sortDir === 'desc' ? base : [...base].reverse();
    }
    return sortDir === 'asc' ? base : [...base].reverse();
  }, [kind, tracks, sortDir]);

  const selected: CategoryGroup | undefined = selectedKey
    ? groups.find((g) => g.key === selectedKey)
    : undefined;

  if (selected) {
    const header = (
      <div className="px-6 py-5 bg-white/[0.02] border-b border-white/10">
        <button
          type="button"
          onClick={() => onSelectKey(null)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-white/65 hover:text-white transition-colors mb-3 cursor-pointer"
        >
          <ArrowLeft size={14} />
          <span>Back to {meta.title}</span>
        </button>
        <div className="flex items-end gap-5">
          <CoverArt
            src={selected.coverArtUrl}
            title={selected.label}
            className="w-28 h-28 rounded-2xl shadow-2xl border border-white/20 shrink-0"
            iconSize={36}
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-bold text-white tracking-tight truncate">{selected.label}</h2>
            {selected.sublabel && (
              <p className="text-xs text-white/55 mt-1 truncate" title={selected.sublabel}>
                {selected.sublabel}
              </p>
            )}
            <p className="text-xs text-white/65 mt-1.5 font-mono tabular-nums">
              {selected.trackCount} {selected.trackCount === 1 ? 'song' : 'songs'} ·{' '}
              {formatTotalDurationHuman(selected.totalDuration)}
            </p>
            <div className="flex items-center gap-2.5 mt-3">
              <button
                type="button"
                onClick={() => onPlayTracks(selected.tracks, false)}
                style={{ backgroundColor: accentColor }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-slate-950 shadow-lg hover:brightness-110 cursor-pointer"
              >
                <Play size={14} className="fill-slate-950" />
                <span>Play All</span>
              </button>
              <button
                type="button"
                onClick={() => onPlayTracks(selected.tracks, true)}
                className="liquid-glass-btn inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium text-white cursor-pointer"
              >
                <Shuffle size={14} />
                <span>Shuffle</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
    return <>{renderTrackList(selected.tracks, header)}</>;
  }

  if (groups.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-20 px-6 text-center">
        <meta.Icon size={28} style={{ color: accentColor }} />
        <p className="text-sm text-white/60 mt-3">{meta.empty}</p>
      </div>
    );
  }

  const isList = gridMode === 'list';
  const isWide = gridMode === 'wide';
  const gridClass = isList
    ? 'grid grid-cols-1 gap-1'
    : isWide
    ? 'grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]'
    : 'grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]';

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      <div className={gridClass}>
        {groups.map((g) => {
          const compact = isList || isWide;
          return (
            <div
              key={g.key}
              onClick={() => onSelectKey(g.key)}
              className={`group flex ${compact ? 'items-center gap-3.5' : 'flex-col'} cursor-pointer transition-all duration-150 ${
                isList
                  ? 'px-3 py-2 rounded-xl hover:bg-white/[0.07]'
                  : 'p-3.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/12 hover:border-white/25 shadow-lg'
              }`}
            >
              <div
                className={`relative overflow-hidden rounded-xl shrink-0 ${
                  compact ? (isList ? 'w-11 h-11' : 'w-[80px] h-[80px]') : 'w-full aspect-square mb-3'
                }`}
              >
                <CoverArt
                  src={g.coverArtUrl}
                  title={g.label}
                  className="w-full h-full rounded-xl"
                  iconSize={compact ? 20 : 36}
                />
                {!compact && kind === 'years' && (
                  <span className="absolute inset-x-0 bottom-0 px-3 py-2 text-2xl font-bold text-white bg-gradient-to-t from-black/70 to-transparent">
                    {g.label}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                {(compact || kind !== 'years') && (
                  <h3 className="text-sm font-semibold text-white truncate">{g.label}</h3>
                )}
                {kind === 'years' && !compact ? null : g.sublabel && (
                  <p className="text-[11px] text-white/55 truncate mt-0.5" title={g.sublabel}>
                    {g.sublabel}
                  </p>
                )}
                <p className="text-[11px] text-white/50 font-mono tabular-nums mt-1 truncate">
                  {g.trackCount} {g.trackCount === 1 ? 'song' : 'songs'} ·{' '}
                  {formatTotalDurationHuman(g.totalDuration)}
                </p>
              </div>
              {compact && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPlayTracks(g.tracks, false);
                }}
                title={`Play ${g.label}`}
                style={{ backgroundColor: accentColor }}
                className={`shrink-0 w-8 h-8 rounded-full text-slate-950 shadow-lg flex items-center justify-center transition-opacity hover:scale-105 cursor-pointer ${
                  'opacity-0 group-hover:opacity-100'
                }`}
              >
                <Play size={14} className="fill-slate-950 ml-0.5" />
              </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
