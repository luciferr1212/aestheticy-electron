import React, { useState } from 'react';
import {
  Play,
  Pause,
  Shuffle,
  ListPlus,
  Edit3,
  Trash2,
  GripVertical,
  Heart,
  MoreHorizontal,
  Check,
  X,
  CornerDownRight,
} from 'lucide-react';
import type { Playlist, Track } from '../shared/ipcTypes.ts';
import { CoverArt } from './CoverArt.tsx';
import { formatDuration, formatTotalDurationHuman } from '../utils/formatters.ts';

interface PlaylistViewProps {
  playlist: Playlist;
  tracks: Track[];
  currentTrackId: number | null;
  isPlaying: boolean;
  accentColor: string;
  onPlayTrack: (track: Track, contextTracks: Track[]) => void;
  onTogglePlayPause: () => void;
  onPlayAll: (tracks: Track[], shuffle?: boolean) => void;
  onPlayNext: (track: Track) => void;
  onAddToQueue: (track: Track) => void;
  onAddAllToQueue: (tracks: Track[]) => void;
  onToggleFavorite: (track: Track) => void;
  onRenamePlaylist: (playlistId: number, name: string, description: string) => Promise<void>;
  onDeletePlaylist: (playlistId: number) => Promise<void>;
  onRemoveTrackFromPlaylist: (playlistId: number, playlistEntryId: number) => Promise<void>;
  onReorderTracks: (playlistId: number, orderedTracks: Track[]) => Promise<void>;
  onOpenContextMenu: (e: React.MouseEvent, track: Track) => void;
  onSelectAlbum?: (album: string, artist: string) => void;
  onSelectArtist?: (artist: string) => void;
}

export const PlaylistView: React.FC<PlaylistViewProps> = ({
  playlist,
  tracks,
  currentTrackId,
  isPlaying,
  accentColor,
  onPlayTrack,
  onTogglePlayPause,
  onPlayAll,
  onPlayNext,
  onAddToQueue,
  onAddAllToQueue,
  onToggleFavorite,
  onRenamePlaylist,
  onDeletePlaylist,
  onRemoveTrackFromPlaylist,
  onReorderTracks,
  onOpenContextMenu,
  onSelectAlbum,
  onSelectArtist,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(playlist.name);
  const [editDesc, setEditDesc] = useState(playlist.description);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const totalDuration = tracks.reduce((sum, t) => sum + t.duration, 0);
  const coverArtUrl =
    tracks.find((t) => t.coverArtUrl)?.coverArtUrl || playlist.coverArtUrl || null;

  const handleSaveRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) return;
    await onRenamePlaylist(playlist.id, editName.trim(), editDesc.trim());
    setIsEditing(false);
  };

  const handleDrop = async (targetIndex: number) => {
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const reordered = [...tracks];
    const [moved] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    setDraggedIndex(null);
    setDragOverIndex(null);
    await onReorderTracks(playlist.id, reordered);
  };

  return (
    <div className="flex-1 h-full overflow-y-auto overflow-x-hidden">
      {/* Playlist Liquid Glass Header */}
      <div className="px-6 py-6 border-b border-white/10 bg-white/[0.02]">
        <div className="flex flex-col sm:flex-row sm:items-end gap-6">
          <CoverArt
            src={coverArtUrl}
            title={playlist.name}
            subtitle={playlist.description}
            className="w-36 h-36 rounded-2xl shadow-2xl border border-white/20"
            iconSize={48}
          />

          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-white/60 mb-1">
              {playlist.isFavorites ? 'System Playlist' : 'Custom Playlist · Drag rows to reorder'}
            </div>

            {isEditing && !playlist.isFavorites ? (
              <form onSubmit={handleSaveRename} className="space-y-2 max-w-md mt-1">
                <input
                  type="text"
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-black/50 border border-white/25 text-lg font-bold text-white focus:outline-none"
                  placeholder="Playlist title"
                />
                <input
                  type="text"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full px-3 py-1 rounded-lg bg-black/50 border border-white/15 text-xs text-white/80 focus:outline-none"
                  placeholder="Optional description..."
                />
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-xs font-semibold text-white cursor-pointer"
                  >
                    <Check size={13} />
                    <span>Save</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditing(false);
                      setEditName(playlist.name);
                      setEditDesc(playlist.description);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-white/80 cursor-pointer"
                  >
                    <X size={13} />
                    <span>Cancel</span>
                  </button>
                </div>
              </form>
            ) : (
              <>
                <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight truncate">
                  {playlist.name}
                </h1>
                {playlist.description && (
                  <p className="text-xs text-white/70 mt-1 max-w-2xl truncate">
                    {playlist.description}
                  </p>
                )}
              </>
            )}

            <div className="flex flex-wrap items-center gap-2 text-xs text-white/60 mt-2.5 font-mono tabular-nums">
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
                className="liquid-glass-btn inline-flex items-center gap-2 px-4 py-2 rounded-xl disabled:opacity-40 text-xs font-medium text-white whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Shuffle size={14} />
                <span>Shuffle</span>
              </button>

              <button
                type="button"
                disabled={tracks.length === 0}
                onClick={() => onAddAllToQueue(tracks)}
                className="liquid-glass-btn inline-flex items-center gap-2 px-3.5 py-2 rounded-xl disabled:opacity-40 text-xs font-medium text-white/85 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ListPlus size={14} />
                <span>Add to Queue</span>
              </button>

              {!playlist.isFavorites && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setEditName(playlist.name);
                      setEditDesc(playlist.description);
                      setIsEditing(true);
                    }}
                    className="liquid-glass-btn inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-white/80 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Edit3 size={13} />
                    <span>Rename</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeletePlaylist(playlist.id)}
                    className="liquid-glass-btn inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-rose-300 hover:text-rose-200 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Trash2 size={13} />
                    <span>Delete Playlist</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Column Headers */}
      <div className="sticky top-0 z-10 grid grid-cols-[56px_minmax(200px,2.2fr)_minmax(130px,1.3fr)_minmax(130px,1.3fr)_120px_110px] items-center h-9 px-5 bg-[#090A0F]/85 backdrop-blur-md border-b border-white/10 text-xs font-medium text-white/55">
        <div className="font-mono tabular-nums text-right pr-3">#</div>
        <div>Title</div>
        <div>Artist</div>
        <div>Album</div>
        <div>Year · Format</div>
        <div className="text-right">Time</div>
      </div>

      {/* Drag-and-Drop Track Rows */}
      {tracks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
          <p className="text-sm font-medium text-white">This playlist has no tracks yet</p>
          <p className="text-xs text-white/55 mt-1">
            Right-click any song in your library and choose &ldquo;Add to Playlist&rdquo;.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {tracks.map((track, idx) => {
            const isCurrent = track.id === currentTrackId;
            const isDragTarget = dragOverIndex === idx && draggedIndex !== idx;

            return (
              <div
                key={track.playlistEntryId || `${track.id}-${idx}`}
                draggable
                onDragStart={() => setDraggedIndex(idx)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverIndex(idx);
                }}
                onDragLeave={() => {
                  if (dragOverIndex === idx) setDragOverIndex(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(idx);
                }}
                onDragEnd={() => {
                  setDraggedIndex(null);
                  setDragOverIndex(null);
                }}
                onDoubleClick={() => onPlayTrack(track, tracks)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onOpenContextMenu(e, track);
                }}
                className={`group grid grid-cols-[56px_minmax(200px,2.2fr)_minmax(130px,1.3fr)_minmax(130px,1.3fr)_120px_110px] items-center h-11 px-5 text-[13px] transition-colors ${
                  isDragTarget
                    ? 'border-t-2 border-indigo-400 bg-indigo-500/15'
                    : isCurrent
                    ? 'bg-white/[0.1] text-white'
                    : 'hover:bg-white/[0.05] text-white/90'
                }`}
              >
                {/* Drag Handle + Index / Play Button */}
                <div className="flex items-center justify-end gap-1.5 pr-3">
                  <span
                    title="Drag to reorder"
                    className="text-white/30 group-hover:text-white/70 cursor-grab active:cursor-grabbing"
                  >
                    <GripVertical size={13} />
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (isCurrent) {
                        onTogglePlayPause();
                      } else {
                        onPlayTrack(track, tracks);
                      }
                    }}
                    className="w-6 h-6 flex items-center justify-center rounded text-white/60 hover:text-white cursor-pointer"
                  >
                    {isCurrent ? (
                      isPlaying ? (
                        <Pause size={13} style={{ color: accentColor }} className="fill-current" />
                      ) : (
                        <Play size={13} style={{ color: accentColor }} className="fill-current" />
                      )
                    ) : (
                      <>
                        <span className="font-mono tabular-nums text-xs text-white/55 group-hover:hidden">
                          {idx + 1}
                        </span>
                        <Play size={13} className="hidden group-hover:block text-white fill-white" />
                      </>
                    )}
                  </button>
                </div>

                {/* Cover + Title */}
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
                    onClick={() => onPlayTrack(track, tracks)}
                    style={{ color: isCurrent ? accentColor : undefined }}
                    className="truncate font-medium text-left text-white cursor-pointer"
                  >
                    {track.title}
                  </button>
                </div>

                {/* Artist */}
                <div className="min-w-0 pr-3">
                  <button
                    type="button"
                    onClick={() => onSelectArtist && onSelectArtist(track.artist)}
                    className="truncate block max-w-full text-left text-white/65 hover:text-white hover:underline cursor-pointer"
                  >
                    {track.artist}
                  </button>
                </div>

                {/* Album */}
                <div className="min-w-0 pr-3">
                  <button
                    type="button"
                    onClick={() => onSelectAlbum && onSelectAlbum(track.album, track.artist)}
                    className="truncate block max-w-full text-left text-white/65 hover:text-white hover:underline cursor-pointer"
                  >
                    {track.album}
                  </button>
                </div>

                {/* Metadata */}
                <div className="flex items-center gap-1.5 text-xs text-white/55 font-mono tabular-nums truncate pr-2">
                  <span>{track.year ?? '—'}</span>
                  <span aria-hidden="true">·</span>
                  <span>{track.format}</span>
                </div>

                {/* Actions + Time */}
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
                      className="p-1 rounded hover:bg-white/10 text-white/70 hover:text-white cursor-pointer"
                    >
                      <CornerDownRight size={13} />
                    </button>
                    {track.playlistEntryId && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveTrackFromPlaylist(playlist.id, track.playlistEntryId!);
                        }}
                        title="Remove from Playlist"
                        className="p-1 rounded hover:bg-rose-500/20 text-white/60 hover:text-rose-300 cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenContextMenu(e, track);
                      }}
                      title="More Options"
                      className="p-1 rounded hover:bg-white/10 text-white/70 hover:text-white cursor-pointer"
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
      )}
    </div>
  );
};
