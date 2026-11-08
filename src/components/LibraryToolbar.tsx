import React from 'react';
import { ArrowDownAZ, ArrowUpAZ, LayoutGrid, RectangleHorizontal, List, X } from 'lucide-react';
import type { ArtistSummary } from '../shared/ipcTypes.ts';
import { CoverArt } from './CoverArt.tsx';
import type { GridMode, SortDir } from '../utils/libraryPrefs.ts';

interface SortOption {
  key: string;
  label: string;
}

interface LibraryToolbarProps {
  accentColor: string;
  sortOptions: SortOption[];
  sortKey: string;
  sortDir: SortDir;
  onChangeSortKey: (key: string) => void;
  onToggleSortDir: () => void;
  /** When provided, the square / wide / list switch is shown (albums & artists views). */
  gridMode?: GridMode;
  onChangeGridMode?: (mode: GridMode) => void;
  /** Right-aligned note, e.g. "42 of 310 songs". */
  summary?: string;
}

const GRID_MODES: Array<{ mode: GridMode; label: string; Icon: typeof LayoutGrid }> = [
  { mode: 'square', label: 'Square cards', Icon: LayoutGrid },
  { mode: 'wide', label: 'Wide cards', Icon: RectangleHorizontal },
  { mode: 'list', label: 'List', Icon: List },
];

export const LibraryToolbar: React.FC<LibraryToolbarProps> = ({
  accentColor,
  sortOptions,
  sortKey,
  sortDir,
  onChangeSortKey,
  onToggleSortDir,
  gridMode,
  onChangeGridMode,
  summary,
}) => {
  return (
    <div className="relative z-10 shrink-0 px-6 py-2 flex flex-wrap items-center gap-3 border-b border-white/10 bg-black/10">
      <label className="flex items-center gap-2 text-[11px] text-white/55">
        <span>Sort by</span>
        <select
          value={sortKey}
          onChange={(e) => onChangeSortKey(e.target.value)}
          className="liquid-glass-btn rounded-lg px-2.5 py-1 text-xs font-medium text-white bg-transparent focus:outline-none cursor-pointer"
        >
          {sortOptions.map((o) => (
            <option key={o.key} value={o.key} className="bg-slate-900 text-white">
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={onToggleSortDir}
        title={sortDir === 'asc' ? 'Ascending (click for descending)' : 'Descending (click for ascending)'}
        className="liquid-glass-btn inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-white/85 hover:text-white cursor-pointer"
      >
        {sortDir === 'asc' ? <ArrowDownAZ size={14} /> : <ArrowUpAZ size={14} />}
        <span>{sortDir === 'asc' ? 'Ascending' : 'Descending'}</span>
      </button>

      <div className="flex-1" />

      {summary && <span className="text-[11px] font-mono tabular-nums text-white/45">{summary}</span>}

      {gridMode && onChangeGridMode && (
        <div className="flex items-center gap-0.5 rounded-xl bg-black/25 border border-white/10 p-0.5">
          {GRID_MODES.map(({ mode, label, Icon }) => {
            const active = gridMode === mode;
            return (
              <button
                key={mode}
                type="button"
                title={label}
                onClick={() => onChangeGridMode(mode)}
                style={active ? { backgroundColor: accentColor, color: '#090A0F' } : undefined}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  active ? 'shadow' : 'text-white/60 hover:text-white hover:bg-white/10'
                }`}
              >
                <Icon size={14} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------------------------

interface ArtistChipsBarProps {
  artists: ArtistSummary[];
  selectedArtist: string | null;
  accentColor: string;
  onSelectArtist: (artist: string | null) => void;
}

/** Horizontal strip of round artist avatars; clicking one filters the view to that artist only. */
export const ArtistChipsBar: React.FC<ArtistChipsBarProps> = ({
  artists,
  selectedArtist,
  accentColor,
  onSelectArtist,
}) => {
  if (artists.length === 0) return null;
  return (
    <div className="relative z-10 shrink-0 border-b border-white/10 bg-black/10">
      <div className="flex items-center gap-3 px-6 py-2.5 overflow-x-auto">
        {selectedArtist && (
          <button
            type="button"
            onClick={() => onSelectArtist(null)}
            className="liquid-glass-btn shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white cursor-pointer"
          >
            <X size={12} />
            <span>Show all</span>
          </button>
        )}
        {artists.map((a) => {
          const active = selectedArtist === a.artist;
          const dim = selectedArtist != null && !active;
          return (
            <button
              key={a.artist}
              type="button"
              onClick={() => onSelectArtist(active ? null : a.artist)}
              title={`${a.artist} · ${a.trackCount} songs`}
              className={`shrink-0 w-[68px] flex flex-col items-center gap-1 cursor-pointer transition-opacity ${
                dim ? 'opacity-45 hover:opacity-90' : 'opacity-100'
              }`}
            >
              <span
                className="block rounded-full p-[2px] transition-all"
                style={{
                  background: active
                    ? accentColor
                    : 'linear-gradient(145deg, rgba(255,255,255,0.35), rgba(255,255,255,0.05))',
                }}
              >
                <CoverArt
                  src={a.coverArtUrl}
                  title={a.artist}
                  className="w-12 h-12 rounded-full"
                  iconSize={18}
                />
              </span>
              <span
                className={`w-full text-center text-[11px] truncate ${
                  active ? 'text-white font-semibold' : 'text-white/70'
                }`}
              >
                {a.artist}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
