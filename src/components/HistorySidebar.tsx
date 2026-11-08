import React, { useCallback, useEffect, useState } from 'react';
import { X, History as HistoryIcon, Play } from 'lucide-react';
import type { HistoryEntry, Track } from '../shared/ipcTypes.ts';
import { CoverArt } from './CoverArt.tsx';
import { ipcClient } from '../services/ipcClient.ts';
import { formatDuration } from '../utils/formatters.ts';

interface HistorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
  accentColor: string;
  /** Changes whenever playback moves to a new track, so the list stays fresh while open. */
  currentTrackId: number | null;
  onPlayTrack: (track: Track) => void;
}

function formatPlayedAt(playedAt: number): string {
  const date = new Date(playedAt);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return `Today · ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday · ${time}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  isOpen,
  onClose,
  accentColor,
  currentTrackId,
  onPlayTrack,
}) => {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setEntries(await ipcClient.getHistory(200));
    } catch {
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    // Small delay lets the main process finish recording the track that just started.
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  }, [isOpen, currentTrackId, refresh]);

  const handleClear = async () => {
    try {
      await ipcClient.clearHistory();
    } finally {
      setEntries([]);
    }
  };

  if (!isOpen) return null;

  return (
    <aside className="w-80 shrink-0 h-full rounded-2xl liquid-glass specular-surface flex flex-col overflow-hidden">
      <div className="relative z-10 flex items-center justify-between px-4 h-13 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <HistoryIcon size={16} style={{ color: accentColor }} />
          <h2 className="text-sm font-semibold text-white whitespace-nowrap shrink-0">
            Listening History
          </h2>
          <span className="text-xs font-mono tabular-nums text-white/55">· {entries.length}</span>
        </div>
        <div className="flex items-center gap-1">
          {entries.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              title="Clear History"
              className="px-2 py-1 rounded text-xs text-white/60 hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            title="Close History"
            className="p-1.5 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {entries.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-white/45">
            {isLoading
              ? 'Loading…'
              : 'Nothing here yet. Songs you play will show up in your history.'}
          </div>
        ) : (
          entries.map((entry, idx) => (
            <div
              key={`hist-${entry.track.id}-${entry.playedAt}-${idx}`}
              className="group flex items-center gap-2.5 p-2 rounded-xl hover:bg-white/[0.08] transition-colors"
            >
              <button
                type="button"
                onClick={() => onPlayTrack(entry.track)}
                className="relative shrink-0 cursor-pointer"
                title="Play Again"
              >
                <CoverArt
                  src={entry.track.coverArtUrl}
                  title={entry.track.album}
                  subtitle={entry.track.artist}
                  className="w-8 h-8 rounded-md"
                  iconSize={14}
                />
                <span className="absolute inset-0 bg-black/60 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Play size={12} className="text-white fill-white" />
                </span>
              </button>
              <div onClick={() => onPlayTrack(entry.track)} className="flex-1 min-w-0 cursor-pointer">
                <p className="text-xs font-medium text-white/90 truncate">{entry.track.title}</p>
                <p className="text-[11px] text-white/60 truncate">
                  {entry.track.artist} · {formatPlayedAt(entry.playedAt)}
                </p>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-white/50">
                {formatDuration(entry.track.duration)}
              </span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
};
