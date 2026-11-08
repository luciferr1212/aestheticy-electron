import React from 'react';
import { X, Trash2, Play, Pause, CornerDownRight, ListMusic } from 'lucide-react';
import type { Track } from '../shared/ipcTypes.ts';
import { CoverArt } from './CoverArt.tsx';
import { formatDuration } from '../utils/formatters.ts';

interface QueueSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  currentTrack: Track | null;
  isPlaying: boolean;
  accentColor: string;
  playNextQueue: Track[];
  standardQueue: Track[];
  onTogglePlayPause: () => void;
  onPlayFromPlayNext: (index: number) => void;
  onPlayFromStandardQueue: (index: number) => void;
  onRemoveFromPlayNext: (index: number) => void;
  onRemoveFromStandardQueue: (index: number) => void;
  onClearQueue: () => void;
}

export const QueueSidebar: React.FC<QueueSidebarProps> = ({
  isOpen,
  onClose,
  currentTrack,
  isPlaying,
  accentColor,
  playNextQueue,
  standardQueue,
  onTogglePlayPause,
  onPlayFromPlayNext,
  onPlayFromStandardQueue,
  onRemoveFromPlayNext,
  onRemoveFromStandardQueue,
  onClearQueue,
}) => {
  if (!isOpen) return null;

  const totalQueued = playNextQueue.length + standardQueue.length;

  return (
    <aside className="w-80 shrink-0 h-full rounded-2xl liquid-glass specular-surface flex flex-col overflow-hidden">
      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-4 h-13 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <ListMusic size={16} style={{ color: accentColor }} />
          <h2 className="text-sm font-semibold text-white whitespace-nowrap shrink-0">
            Playback Queue
          </h2>
          <span className="text-xs font-mono tabular-nums text-white/55">
            · {totalQueued}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {totalQueued > 0 && (
            <button
              type="button"
              onClick={onClearQueue}
              title="Clear Queue"
              className="px-2 py-1 rounded text-xs text-white/60 hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            title="Close Queue Sidebar"
            className="p-1.5 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto px-3 py-3 space-y-5">
        {/* Now Playing Section */}
        <div>
          <div className="px-1.5 mb-2 text-xs font-medium text-white/60">
            Now Playing
          </div>
          {currentTrack ? (
            <div className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.07] border border-white/15">
              <div className="relative group shrink-0">
                <CoverArt
                  src={currentTrack.coverArtUrl}
                  title={currentTrack.album}
                  subtitle={currentTrack.artist}
                  className="w-11 h-11 rounded-lg"
                  iconSize={20}
                />
                <button
                  type="button"
                  onClick={onTogglePlayPause}
                  className="absolute inset-0 bg-black/55 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  {isPlaying ? (
                    <Pause size={16} className="text-white fill-white" />
                  ) : (
                    <Play size={16} className="text-white fill-white" />
                  )}
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className="text-xs font-semibold truncate"
                  style={{ color: accentColor }}
                >
                  {currentTrack.title}
                </p>
                <p className="text-xs text-white/70 truncate mt-0.5">
                  {currentTrack.artist}
                </p>
                <p className="text-[11px] font-mono tabular-nums text-white/45 mt-0.5">
                  {currentTrack.format} · {formatDuration(currentTrack.duration)}
                </p>
              </div>
            </div>
          ) : (
            <div className="px-2 py-4 text-xs text-white/50 text-center border border-dashed border-white/15 rounded-xl">
              No track currently active
            </div>
          )}
        </div>

        {/* Priority "Play Next" Queue */}
        {playNextQueue.length > 0 && (
          <div>
            <div className="flex items-center justify-between px-1.5 mb-1.5">
              <span
                className="inline-flex items-center gap-1.5 text-xs font-medium"
                style={{ color: accentColor }}
              >
                <CornerDownRight size={12} />
                <span>Next Up (Priority)</span>
              </span>
              <span className="text-[11px] font-mono tabular-nums text-white/55">
                {playNextQueue.length}
              </span>
            </div>
            <div className="space-y-1">
              {playNextQueue.map((track, idx) => (
                <div
                  key={`next-${track.id}-${idx}`}
                  className="group flex items-center gap-2.5 p-2 rounded-xl hover:bg-white/[0.08] transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => onPlayFromPlayNext(idx)}
                    className="relative shrink-0 cursor-pointer"
                    title="Play Now"
                  >
                    <CoverArt
                      src={track.coverArtUrl}
                      title={track.album}
                      subtitle={track.artist}
                      className="w-8 h-8 rounded-md"
                      iconSize={14}
                    />
                    <span className="absolute inset-0 bg-black/60 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play size={12} className="text-white fill-white" />
                    </span>
                  </button>
                  <div
                    onClick={() => onPlayFromPlayNext(idx)}
                    className="flex-1 min-w-0 cursor-pointer"
                  >
                    <p className="text-xs font-medium text-white truncate">
                      {track.title}
                    </p>
                    <p className="text-[11px] text-white/60 truncate">
                      {track.artist}
                    </p>
                  </div>
                  <span className="text-[11px] font-mono tabular-nums text-white/50 group-hover:hidden">
                    {formatDuration(track.duration)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveFromPlayNext(idx)}
                    title="Remove from Queue"
                    className="hidden group-hover:flex p-1 rounded text-white/60 hover:text-rose-400 hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Standard Queue */}
        <div>
          <div className="flex items-center justify-between px-1.5 mb-1.5">
            <span className="text-xs font-medium text-white/60">Later in Queue</span>
            <span className="text-[11px] font-mono tabular-nums text-white/55">
              {standardQueue.length}
            </span>
          </div>

          {standardQueue.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-white/45">
              Use &ldquo;Play Next&rdquo; or &ldquo;Add to Queue&rdquo; on any track to build your listening session.
            </div>
          ) : (
            <div className="space-y-1">
              {standardQueue.slice(0, 120).map((track, idx) => (
                <div
                  key={`queue-${track.id}-${idx}`}
                  className="group flex items-center gap-2.5 p-2 rounded-xl hover:bg-white/[0.08] transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => onPlayFromStandardQueue(idx)}
                    className="relative shrink-0 cursor-pointer"
                    title="Play Now"
                  >
                    <CoverArt
                      src={track.coverArtUrl}
                      title={track.album}
                      subtitle={track.artist}
                      className="w-8 h-8 rounded-md"
                      iconSize={14}
                    />
                    <span className="absolute inset-0 bg-black/60 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play size={12} className="text-white fill-white" />
                    </span>
                  </button>
                  <div
                    onClick={() => onPlayFromStandardQueue(idx)}
                    className="flex-1 min-w-0 cursor-pointer"
                  >
                    <p className="text-xs font-medium text-white/90 truncate">
                      {track.title}
                    </p>
                    <p className="text-[11px] text-white/60 truncate">
                      {track.artist}
                    </p>
                  </div>
                  <span className="text-[11px] font-mono tabular-nums text-white/50 group-hover:hidden">
                    {formatDuration(track.duration)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveFromStandardQueue(idx)}
                    title="Remove from Queue"
                    className="hidden group-hover:flex p-1 rounded text-white/60 hover:text-rose-400 hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {standardQueue.length > 120 && (
                <div className="py-2 text-center text-[11px] font-mono tabular-nums text-white/45">
                  + {standardQueue.length - 120} more tracks in queue
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
