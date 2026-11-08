import React, { useEffect, useMemo, useState } from 'react';
import { X, Copy, Check, AudioWaveform, Tags, Volume2, HardDrive, Loader2 } from 'lucide-react';
import type { Track, TrackAudioInfo } from '../shared/ipcTypes.ts';
import { ipcClient } from '../services/ipcClient.ts';
import { CoverArt } from './CoverArt.tsx';
import {
  formatBitrate,
  formatDuration,
  formatFileSize,
  isTrackLossless,
} from '../utils/formatters.ts';
import { QUALITY_LABELS, getQualityTier } from '../utils/libraryPrefs.ts';

interface AudioInfoModalProps {
  track: Track;
  accentColor: string;
  onClose: () => void;
}

type Row = [label: string, value: string | null | undefined];

function channelLabel(n: number | null | undefined): string | null {
  if (!n) return null;
  if (n === 1) return 'Mono';
  if (n === 2) return 'Stereo';
  if (n === 6) return '5.1 Surround';
  if (n === 8) return '7.1 Surround';
  return `${n} channels`;
}

function khz(hz: number | null | undefined): string | null {
  if (!hz) return null;
  const v = hz / 1000;
  return `${Number.isInteger(v) ? v : v.toFixed(1)} kHz`;
}

function db(v: number | null | undefined): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)} dB`;
}

function peakDb(ratio: number | null | undefined): string | null {
  if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) return null;
  return `${(20 * Math.log10(ratio)).toFixed(2)} dBFS`;
}

function dateText(ms: number | null | undefined): string | null {
  if (!ms) return null;
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return null;
  }
}

const Section: React.FC<{
  icon: React.ReactNode;
  title: string;
  rows: Row[];
  accentColor: string;
}> = ({ icon, title, rows, accentColor }) => {
  const visible = rows.filter(([, v]) => v != null && v !== '');
  if (visible.length === 0) return null;
  return (
    <section className="rounded-2xl bg-black/25 border border-white/10 p-4">
      <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/55 mb-2.5">
        <span style={{ color: accentColor }}>{icon}</span>
        {title}
      </h3>
      <dl className="space-y-1.5">
        {visible.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4 text-xs">
            <dt className="text-white/50 shrink-0">{label}</dt>
            <dd className="text-white text-right font-medium break-words min-w-0 tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
};

export const AudioInfoModal: React.FC<AudioInfoModalProps> = ({ track, accentColor, onClose }) => {
  const [info, setInfo] = useState<TrackAudioInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ipcClient
      .getTrackAudioInfo(track.id)
      .then((res) => {
        if (!cancelled) setInfo(res);
      })
      .catch(() => {
        if (!cancelled) setInfo(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [track.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tier = getQualityTier(track);
  const tierMeta = QUALITY_LABELS[tier];
  const lossless = info?.lossless ?? isTrackLossless(track);
  const sampleRate = info?.sampleRate ?? track.sampleRate ?? null;
  const bitDepth = info?.bitDepth ?? track.bitDepth ?? null;
  const bitrate = info?.bitrate ?? track.bitrate ?? null;

  const headline = useMemo(() => {
    const parts: string[] = [];
    if (bitDepth) parts.push(`${bitDepth}-bit`);
    const sr = khz(sampleRate);
    if (sr) parts.push(sr);
    if (parts.length === 0 && bitrate) parts.push(formatBitrate(bitrate) ?? '');
    return parts.join(' / ');
  }, [bitDepth, sampleRate, bitrate]);

  const signalRows: Row[] = [
    ['Format', [info?.container ?? track.format, info?.codec && info.codec !== info.container ? info.codec : null].filter(Boolean).join(' · ')],
    ['Codec profile', info?.codecProfile],
    ['Compression', lossless == null ? null : lossless ? 'Lossless' : 'Lossy'],
    ['Sample rate', sampleRate ? `${sampleRate.toLocaleString()} Hz (${khz(sampleRate)})` : null],
    ['Bit depth', bitDepth ? `${bitDepth}-bit` : null],
    ['Channels', channelLabel(info?.channels)],
    ['Bitrate', bitrate ? `${Math.round(bitrate).toLocaleString()} kbps` : null],
    ['Duration', formatDuration(info?.duration ?? track.duration)],
    ['Total samples', info?.numberOfSamples ? info.numberOfSamples.toLocaleString() : null],
  ];

  const rg = info?.replayGain;
  const loudnessRows: Row[] = [
    ['ReplayGain (track)', db(rg?.trackGainDb)],
    ['Track peak', peakDb(rg?.trackPeak)],
    ['ReplayGain (album)', db(rg?.albumGainDb)],
    ['Album peak', peakDb(rg?.albumPeak)],
    ['Analysed loudness gain', db(track.loudnessGainDb)],
  ];

  const trackNo = info?.trackNo ?? track.trackNumber;
  const tagRows: Row[] = [
    ['Title', track.title],
    ['Artist', track.artist],
    ['Album artist', info?.albumArtist],
    ['Album', track.album],
    ['Track', trackNo ? `${trackNo}${info?.trackOf ? ` of ${info.trackOf}` : ''}` : null],
    ['Disc', info?.discNo ? `${info.discNo}${info.discOf ? ` of ${info.discOf}` : ''}` : null],
    ['Released', info?.date ?? (track.year ? String(track.year) : null)],
    ['Genre', info?.genre?.join(', ')],
    ['Composer', info?.composer?.join(', ')],
    ['Label', info?.label?.join(', ')],
    ['ISRC', track.isrc],
    ['Encoder', info?.encoder],
    ['Tag formats', info?.tagTypes?.join(', ')],
    ['Embedded artwork', info ? (info.hasEmbeddedCover ? 'Yes' : 'No') : null],
    ['Comment', info?.comment],
  ];

  const fileRows: Row[] = [
    ['Location', track.filePath],
    ['Size', track.fileSize ? formatFileSize(track.fileSize) : null],
    ['Modified', dateText(track.modifiedAt)],
  ];

  const copyText = () => {
    const lines: string[] = [`${track.title} — ${track.artist}`, ''];
    const dump = (title: string, rows: Row[]) => {
      const vis = rows.filter(([, v]) => v != null && v !== '');
      if (vis.length === 0) return;
      lines.push(`[${title}]`);
      vis.forEach(([l, v]) => lines.push(`${l}: ${v}`));
      lines.push('');
    };
    dump('Signal', signalRows);
    dump('Loudness', loudnessRows);
    dump('Tags', tagRows);
    dump('File', fileRows);
    navigator.clipboard
      ?.writeText(lines.join('\n'))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-6 bg-black/55"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Audio details"
        className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-3xl liquid-glass-elevated specular-surface overflow-hidden"
      >
        {/* Header */}
        <div className="relative z-10 flex items-center gap-4 p-5 border-b border-white/10">
          <CoverArt
            src={track.coverArtUrl}
            title={track.album}
            subtitle={track.artist}
            className="w-20 h-20 rounded-xl shadow-xl border border-white/15 shrink-0"
            iconSize={28}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider text-slate-950"
                style={{ backgroundColor: tier === 'unknown' ? 'rgba(255,255,255,0.5)' : accentColor }}
              >
                {tierMeta.label}
              </span>
              {headline && (
                <span className="text-xs font-mono tabular-nums text-white/75">{headline}</span>
              )}
            </div>
            <h2 className="text-lg font-bold text-white truncate mt-1.5">{track.title}</h2>
            <p className="text-xs text-white/65 truncate">
              {track.artist} · {track.album}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={copyText}
              className="liquid-glass-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-white cursor-pointer"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close"
              className="liquid-glass-btn p-2 rounded-xl text-white/80 hover:text-white cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="relative z-10 flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-white/55 mb-3">
              <Loader2 size={13} className="animate-spin" />
              <span>Reading the file&apos;s tags…</span>
            </div>
          )}
          {!loading && !info && (
            <p className="text-[11px] text-amber-300/85 mb-3">
              The audio file could not be read right now (moved, offline drive or unsupported tags).
              Showing what is stored in your library.
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Section icon={<AudioWaveform size={13} />} title="Signal" rows={signalRows} accentColor={accentColor} />
            <Section icon={<Volume2 size={13} />} title="Loudness" rows={loudnessRows} accentColor={accentColor} />
            <Section icon={<Tags size={13} />} title="Tags" rows={tagRows} accentColor={accentColor} />
            <Section icon={<HardDrive size={13} />} title="File" rows={fileRows} accentColor={accentColor} />
          </div>
          <p className="text-[11px] text-white/40 mt-4 leading-relaxed">{tierMeta.hint}. Values are read directly
            from the file&apos;s metadata.</p>
        </div>
      </div>
    </div>
  );
};
