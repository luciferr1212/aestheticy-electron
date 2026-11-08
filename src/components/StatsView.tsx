import React, { useCallback, useEffect, useState } from 'react';
import { Play, RefreshCw, Clock, Music, Users, Disc } from 'lucide-react';
import type { ListeningStats, Track } from '../shared/ipcTypes.ts';
import { CoverArt } from './CoverArt.tsx';
import { ipcClient } from '../services/ipcClient.ts';

interface StatsViewProps {
  accentColor: string;
  onPlayTrack: (track: Track) => void;
}

function formatListenTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 1) return '0 min';
  const mins = Math.floor(seconds / 60);
  const hrs = Math.floor(mins / 60);
  if (hrs >= 24) {
    const days = Math.floor(hrs / 24);
    return `${days}d ${hrs % 24}h`;
  }
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  if (mins > 0) return `${mins} min`;
  return `${Math.floor(seconds)} sec`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const StatsView: React.FC<StatsViewProps> = ({ accentColor, onPlayTrack }) => {
  const [stats, setStats] = useState<ListeningStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setStats(await ipcClient.getListeningStats());
    } catch {
      setStats(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const handleReset = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    await ipcClient.resetListeningStats().catch(() => {});
    setConfirmReset(false);
    await load();
  };

  const isEmpty = !stats || stats.totalPlays === 0;
  const maxDay = Math.max(1, ...(stats?.last7Days.map((d) => d.plays) ?? [1]));

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Your Listening Stats</h2>
          <p className="text-xs text-white/55">
            {stats?.firstPlayedAt
              ? `Since ${new Date(stats.firstPlayedAt).toLocaleDateString([], {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}`
              : 'Play some music and your stats will appear here.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            title="Refresh"
            className="liquid-glass-btn p-2 rounded-xl text-white/75 hover:text-white cursor-pointer"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          {!isEmpty && (
            <button
              type="button"
              onClick={handleReset}
              className="liquid-glass-btn px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer"
              style={confirmReset ? { color: '#fda4af' } : undefined}
            >
              {confirmReset ? 'Click again to confirm' : 'Reset Stats'}
            </button>
          )}
        </div>
      </div>

      {isEmpty ? (
        <div className="py-20 text-center text-sm text-white/50">
          {isLoading ? 'Loading…' : 'No listening data yet. Start playing something!'}
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { icon: Clock, label: 'Listening time', value: formatListenTime(stats!.totalListenSeconds) },
              { icon: Play, label: 'Total plays', value: stats!.totalPlays.toLocaleString() },
              { icon: Music, label: 'Different songs', value: stats!.uniqueTracks.toLocaleString() },
              { icon: Users, label: 'Different artists', value: stats!.uniqueArtists.toLocaleString() },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-2xl bg-black/25 border border-white/10 p-4 space-y-1.5"
              >
                <card.icon size={15} style={{ color: accentColor }} />
                <p className="text-2xl font-bold text-white tabular-nums">{card.value}</p>
                <p className="text-[11px] text-white/55">{card.label}</p>
              </div>
            ))}
          </div>

          {/* Last 7 days */}
          <section className="rounded-2xl bg-black/25 border border-white/10 p-5 space-y-4">
            <h3 className="text-sm font-bold text-white">Last 7 days</h3>
            <div className="flex items-end gap-3 h-32">
              {stats!.last7Days.map((day) => {
                const date = new Date(`${day.date}T00:00:00`);
                const height = Math.max(4, Math.round((day.plays / maxDay) * 100));
                return (
                  <div key={day.date} className="flex-1 flex flex-col items-center justify-end gap-1.5 h-full">
                    <span className="text-[11px] font-mono tabular-nums text-white/55">
                      {day.plays > 0 ? day.plays : ''}
                    </span>
                    <div
                      className="w-full rounded-lg transition-all"
                      style={{
                        height: `${height}%`,
                        backgroundColor: day.plays > 0 ? accentColor : 'rgba(255,255,255,0.08)',
                        opacity: day.plays > 0 ? 0.9 : 1,
                      }}
                      title={`${day.plays} plays`}
                    />
                    <span className="text-[11px] text-white/55">{WEEKDAYS[date.getDay()]}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Top tracks */}
            <section className="rounded-2xl bg-black/25 border border-white/10 p-5 space-y-3">
              <h3 className="text-sm font-bold text-white">Top songs</h3>
              <div className="space-y-1">
                {stats!.topTracks.map((entry, idx) => (
                  <button
                    key={entry.track.id}
                    type="button"
                    onClick={() => onPlayTrack(entry.track)}
                    className="group w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.08] text-left cursor-pointer"
                  >
                    <span className="w-5 text-center text-xs font-mono tabular-nums text-white/45">
                      {idx + 1}
                    </span>
                    <CoverArt
                      src={entry.track.coverArtUrl}
                      title={entry.track.album}
                      subtitle={entry.track.artist}
                      className="w-9 h-9 rounded-md shrink-0"
                      iconSize={14}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white truncate">{entry.track.title}</p>
                      <p className="text-[11px] text-white/55 truncate">{entry.track.artist}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-semibold tabular-nums" style={{ color: accentColor }}>
                        {entry.playCount} {entry.playCount === 1 ? 'play' : 'plays'}
                      </p>
                      <p className="text-[11px] text-white/45">{formatListenTime(entry.listenSeconds)}</p>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            {/* Top artists */}
            <section className="rounded-2xl bg-black/25 border border-white/10 p-5 space-y-3">
              <h3 className="text-sm font-bold text-white">Top artists</h3>
              <div className="space-y-1">
                {stats!.topArtists.map((entry, idx) => (
                  <div key={entry.artist} className="flex items-center gap-3 p-2 rounded-xl">
                    <span className="w-5 text-center text-xs font-mono tabular-nums text-white/45">
                      {idx + 1}
                    </span>
                    <CoverArt
                      src={entry.coverArtUrl}
                      title={entry.artist}
                      subtitle=""
                      className="w-9 h-9 rounded-full shrink-0"
                      iconSize={14}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white truncate">{entry.artist}</p>
                      <p className="text-[11px] text-white/55">
                        {entry.trackCount} {entry.trackCount === 1 ? 'song' : 'songs'} played
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-semibold tabular-nums" style={{ color: accentColor }}>
                        {entry.playCount} plays
                      </p>
                      <p className="text-[11px] text-white/45">{formatListenTime(entry.listenSeconds)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Top albums */}
          {stats!.topAlbums.length > 0 && (
            <section className="rounded-2xl bg-black/25 border border-white/10 p-5 space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                <Disc size={14} style={{ color: accentColor }} />
                Top albums
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                {stats!.topAlbums.map((entry) => (
                  <div key={`${entry.album}-${entry.artist}`} className="space-y-2">
                    <CoverArt
                      src={entry.coverArtUrl}
                      title={entry.album}
                      subtitle={entry.artist}
                      className="w-full aspect-square rounded-xl"
                      iconSize={28}
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-white truncate">{entry.album}</p>
                      <p className="text-[11px] text-white/55 truncate">{entry.artist}</p>
                      <p className="text-[11px] text-white/45">{entry.playCount} plays</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};
