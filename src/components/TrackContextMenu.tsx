import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  CornerDownRight,
  ListPlus,
  Heart,
  FolderPlus,
  Plus,
  Disc,
  User,
  Trash2,
  ChevronRight,
  Radio,
  Info,
} from 'lucide-react';
import type { Playlist, Track } from '../shared/ipcTypes.ts';

interface TrackContextMenuProps {
  track: Track | null;
  x: number;
  y: number;
  playlists: Playlist[];
  currentPlaylistId?: number | null;
  onClose: () => void;
  onPlayNow: (track: Track) => void;
  onPlayNext: (track: Track) => void;
  onAddToQueue: (track: Track) => void;
  onAddTrackToJamQueue?: (track: Track) => void;
  onToggleFavorite: (track: Track) => void;
  onAddTrackToPlaylist: (playlistId: number, track: Track) => void;
  onCreatePlaylistWithTrack: (name: string, track: Track) => void;
  onRemoveFromCurrentPlaylist?: (track: Track) => void;
  onSelectAlbum?: (album: string, artist: string) => void;
  onSelectArtist?: (artist: string) => void;
  onShowAudioInfo?: (track: Track) => void;
}

export const TrackContextMenu: React.FC<TrackContextMenuProps> = ({
  track,
  x,
  y,
  playlists,
  currentPlaylistId,
  onClose,
  onPlayNow,
  onPlayNext,
  onAddToQueue,
  onAddTrackToJamQueue,
  onToggleFavorite,
  onAddTrackToPlaylist,
  onCreatePlaylistWithTrack,
  onRemoveFromCurrentPlaylist,
  onSelectAlbum,
  onSelectArtist,
  onShowAudioInfo,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  if (!track) return null;

  const userPlaylists = playlists.filter((p) => !p.isFavorites);
  const safeLeft = Math.min(x, window.innerWidth - 260);
  const safeTop = Math.min(y, window.innerHeight - 360);

  return (
    <div
      ref={menuRef}
      style={{ left: `${Math.max(12, safeLeft)}px`, top: `${Math.max(12, safeTop)}px` }}
      className="fixed z-50 w-60 rounded-xl liquid-glass-elevated p-1.5 text-xs text-white/90 shadow-2xl"
    >
      {/* Header summary */}
      <div className="px-2.5 py-2 border-b border-white/10 mb-1">
        <div className="font-semibold text-white truncate">{track.title}</div>
        <div className="text-[11px] text-white/60 truncate">
          {track.artist} · {track.album}
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          onPlayNow(track);
          onClose();
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-white/12 text-left transition-colors cursor-pointer"
      >
        <Play size={13} className="fill-current" />
        <span>Play Now</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onPlayNext(track);
          onClose();
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-white/12 text-left transition-colors cursor-pointer"
      >
        <CornerDownRight size={13} />
        <span>Play Next</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onAddToQueue(track);
          onClose();
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-white/12 text-left transition-colors cursor-pointer"
      >
        <ListPlus size={13} />
        <span>Add to Queue</span>
      </button>

      {onAddTrackToJamQueue && (
        <button
          type="button"
          onClick={() => {
            onAddTrackToJamQueue(track);
            onClose();
          }}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-emerald-500/20 text-emerald-300 text-left transition-colors cursor-pointer"
        >
          <Radio size={13} />
          <span>Add to Shared Jam Queue</span>
        </button>
      )}

      <div className="my-1 border-t border-white/10" />

      <button
        type="button"
        onClick={() => {
          onToggleFavorite(track);
          onClose();
        }}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-white/12 text-left transition-colors cursor-pointer"
      >
        <Heart
          size={13}
          className={track.isFavorite ? 'text-rose-400 fill-rose-400' : 'text-white/75'}
        />
        <span>{track.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}</span>
      </button>

      {onShowAudioInfo && (
        <button
          type="button"
          onClick={() => {
            onShowAudioInfo(track);
            onClose();
          }}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-white/12 text-left transition-colors cursor-pointer"
        >
          <Info size={13} className="text-white/75" />
          <span>Audio Details…</span>
        </button>
      )}

      {/* Add to Playlist Section */}
      <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-white/50 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <FolderPlus size={12} />
          <span>Add to Playlist</span>
        </span>
        <ChevronRight size={11} />
      </div>

      <div className="max-h-36 overflow-y-auto space-y-0.5 pl-2">
        {userPlaylists.map((pl) => (
          <button
            key={pl.id}
            type="button"
            onClick={() => {
              onAddTrackToPlaylist(pl.id, track);
              onClose();
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-white/12 text-left transition-colors cursor-pointer"
          >
            <span className="truncate">{pl.name}</span>
            <span className="font-mono text-[10px] text-white/45">{pl.trackCount}</span>
          </button>
        ))}

        {!showNewInput ? (
          <button
            type="button"
            onClick={() => setShowNewInput(true)}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/12 text-left text-indigo-300 transition-colors cursor-pointer"
          >
            <Plus size={12} />
            <span>New Playlist with Track...</span>
          </button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newPlaylistName.trim()) return;
              onCreatePlaylistWithTrack(newPlaylistName.trim(), track);
              onClose();
            }}
            className="p-1.5 flex items-center gap-1.5"
          >
            <input
              type="text"
              autoFocus
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="Playlist name..."
              className="flex-1 px-2 py-1 rounded bg-black/50 border border-white/20 text-xs text-white focus:outline-none"
            />
            <button
              type="submit"
              className="px-2 py-1 rounded bg-indigo-500 text-white text-[11px] font-medium cursor-pointer"
            >
              Add
            </button>
          </form>
        )}
      </div>

      {currentPlaylistId && onRemoveFromCurrentPlaylist && track.playlistEntryId && (
        <>
          <div className="my-1 border-t border-white/10" />
          <button
            type="button"
            onClick={() => {
              onRemoveFromCurrentPlaylist(track);
              onClose();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-rose-500/20 text-rose-300 text-left transition-colors cursor-pointer"
          >
            <Trash2 size={13} />
            <span>Remove from Playlist</span>
          </button>
        </>
      )}

      {(onSelectAlbum || onSelectArtist) && (
        <>
          <div className="my-1 border-t border-white/10" />
          {onSelectAlbum && (
            <button
              type="button"
              onClick={() => {
                onSelectAlbum(track.album, track.artist);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-white/12 text-left transition-colors cursor-pointer"
            >
              <Disc size={13} />
              <span className="truncate">Go to Album</span>
            </button>
          )}
          {onSelectArtist && (
            <button
              type="button"
              onClick={() => {
                onSelectArtist(track.artist);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-white/12 text-left transition-colors cursor-pointer"
            >
              <User size={13} />
              <span className="truncate">Go to Artist</span>
            </button>
          )}
        </>
      )}
    </div>
  );
};
