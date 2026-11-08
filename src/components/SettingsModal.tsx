import React, { useEffect, useState } from 'react';
import {
  Sliders,
  Speaker,
  RotateCcw,
  X,
  Check,
  Film,
  Trash2,
  Cpu,
  Gauge,
  Shuffle,
} from 'lucide-react';
import type {
  CanvasCacheStats,
  EqualizerSettings,
  FfmpegStatus,
  TranscodeCacheStats,
} from '../shared/ipcTypes.ts';
import { EQ_FREQUENCY_LABELS, EQ_PRESETS } from '../utils/audioEqualizer.ts';
import { ipcClient } from '../services/ipcClient.ts';
import { formatFileSize } from '../utils/formatters.ts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  equalizer: EqualizerSettings;
  outputDeviceId: string;
  canvasEnabled: boolean;
  normalizeVolume: boolean;
  crossfadeSeconds: number;
  gaplessPlayback: boolean;
  accentColor: string;
  onChangeEqualizer: (next: EqualizerSettings) => void;
  onChangeOutputDevice: (deviceId: string) => void;
  onChangeCanvasEnabled: (enabled: boolean) => void;
  onChangeNormalizeVolume: (enabled: boolean) => void;
  onChangeCrossfadeSeconds: (seconds: number) => void;
  onChangeGaplessPlayback: (enabled: boolean) => void;
}

interface AudioDeviceOption {
  deviceId: string;
  label: string;
}

const CROSSFADE_OPTIONS = [0, 2, 4, 6, 8, 12];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  equalizer,
  outputDeviceId,
  canvasEnabled,
  normalizeVolume,
  crossfadeSeconds,
  gaplessPlayback,
  accentColor,
  onChangeEqualizer,
  onChangeOutputDevice,
  onChangeCanvasEnabled,
  onChangeNormalizeVolume,
  onChangeCrossfadeSeconds,
  onChangeGaplessPlayback,
}) => {
  const [devices, setDevices] = useState<AudioDeviceOption[]>([
    { deviceId: 'default', label: 'System Default Output (WASAPI Shared)' },
    { deviceId: 'communications', label: 'Windows Communications Output' },
  ]);
  const [canvasStats, setCanvasStats] = useState<CanvasCacheStats | null>(null);
  const [isClearingCanvas, setIsClearingCanvas] = useState(false);

  const [ffmpegStatus, setFfmpegStatus] = useState<FfmpegStatus | null>(null);
  const [transcodeCacheStats, setTranscodeCacheStats] = useState<TranscodeCacheStats | null>(null);
  const [isClearingTranscodeCache, setIsClearingTranscodeCache] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    ipcClient
      .getCanvasCacheStats()
      .then((stats) => setCanvasStats(stats))
      .catch(() => {});

    ipcClient
      .getFfmpegStatus()
      .then((status) => {
        setFfmpegStatus(status);
        setTranscodeCacheStats(status.cacheStats);
      })
      .catch(() => {});

    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices
        .enumerateDevices()
        .then((list) => {
          const outputs = list
            .filter((d) => d.kind === 'audiooutput')
            .map((d, idx) => ({
              deviceId: d.deviceId || `device-${idx}`,
              label:
                d.label ||
                (d.deviceId === 'default'
                  ? 'System Default Audio Output'
                  : `Audio Output Device #${idx + 1}`),
            }));
          if (outputs.length > 0) {
            setDevices(outputs);
          }
        })
        .catch(() => {
          // Keep default fallback list
        });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePresetChange = (presetName: string) => {
    const presetBands = EQ_PRESETS[presetName];
    if (presetBands) {
      onChangeEqualizer({
        ...equalizer,
        preset: presetName,
        bands: [...presetBands],
      });
    }
  };

  const handleBandChange = (index: number, gainValue: number) => {
    const nextBands = [...equalizer.bands];
    nextBands[index] = gainValue;
    onChangeEqualizer({
      ...equalizer,
      preset: 'Custom',
      bands: nextBands,
    });
  };

  const handleResetEqualizer = () => {
    onChangeEqualizer({
      enabled: true,
      preset: 'Flat',
      preamp: 0,
      bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
  };

  // Build SVG polyline points for the 10-band EQ curve visualization
  const svgWidth = 540;
  const svgHeight = 90;
  const points = equalizer.bands
    .map((gain, i) => {
      const x = (i / 9) * (svgWidth - 40) + 20;
      const y = svgHeight / 2 - (gain / 12) * (svgHeight / 2 - 12);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
      <div className="w-full max-w-2xl rounded-2xl liquid-glass-elevated specular-surface overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/12">
          <div className="flex items-center gap-2.5">
            <Sliders size={18} style={{ color: accentColor }} />
            <h2 className="text-base font-bold text-white">
              Audio Engine, Equalizer & FFmpeg Transcode Settings
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/65 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[82vh] overflow-y-auto">
          {/* Section 1: Playback Transitions, Loudness Normalization & Gapless */}
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-white mb-3">
              <Gauge size={14} style={{ color: accentColor }} />
              <span>Loudness Normalization, Crossfade & Gapless Playback</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              {/* Normalize Volume (EBU R128) */}
              <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-black/30 border border-white/10">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white">Normalize Volume</div>
                  <div className="text-[11px] text-white/55 mt-0.5">
                    FFmpeg EBU R128 loudness analysis (-14 LUFS target)
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onChangeNormalizeVolume(!normalizeVolume)}
                  style={normalizeVolume ? { backgroundColor: accentColor } : undefined}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 cursor-pointer ${
                    normalizeVolume
                      ? 'text-slate-950'
                      : 'bg-white/10 text-white/65 hover:text-white'
                  }`}
                >
                  {normalizeVolume ? 'Enabled' : 'Off'}
                </button>
              </div>

              {/* Gapless Playback */}
              <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-black/30 border border-white/10">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white">Gapless Playback</div>
                  <div className="text-[11px] text-white/55 mt-0.5">
                    Pre-buffers & pre-transcodes the next queued track
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onChangeGaplessPlayback(!gaplessPlayback)}
                  style={gaplessPlayback ? { backgroundColor: accentColor } : undefined}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 cursor-pointer ${
                    gaplessPlayback
                      ? 'text-slate-950'
                      : 'bg-white/10 text-white/65 hover:text-white'
                  }`}
                >
                  {gaplessPlayback ? 'Enabled' : 'Off'}
                </button>
              </div>
            </div>

            {/* Crossfade Duration Selector */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-black/30 border border-white/10">
              <div className="flex items-center gap-2.5">
                <Shuffle size={14} style={{ color: accentColor }} />
                <div>
                  <div className="text-xs font-semibold text-white">Crossfade Tracks</div>
                  <div className="text-[11px] text-white/55">
                    Smoothly overlap outgoing and incoming tracks
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {CROSSFADE_OPTIONS.map((sec) => {
                  const active = crossfadeSeconds === sec;
                  return (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => onChangeCrossfadeSeconds(sec)}
                      style={active ? { backgroundColor: accentColor } : undefined}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-colors cursor-pointer ${
                        active
                          ? 'text-slate-950 font-semibold'
                          : 'bg-white/5 text-white/65 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      {sec === 0 ? 'Off' : `${sec}s`}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Section 2: FFmpeg Transcode Cache (2 GB LRU Cap) */}
          <div className="pt-4 border-t border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-white/5 border border-white/10 mt-0.5">
                  <Cpu size={16} style={{ color: accentColor }} />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white">
                    FFmpeg Lossless Transcode Cache (ALAC, AIFF, WV, APE, WMA, DSF, DFF)
                  </div>
                  <p className="text-[11px] text-white/60 mt-0.5 max-w-md">
                    Unsupported formats or files that fail native decoding are transcoded to lossless
                    FLAC/WAV in the background. Capped at 2.00 GB with least-recently-used cleanup.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums text-white/50 mt-1.5">
                    <span>
                      {ffmpegStatus?.available ? 'FFmpeg & FFprobe Active' : 'FFmpeg Standby'}
                    </span>
                    {transcodeCacheStats && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{transcodeCacheStats.fileCount} cached files</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {formatFileSize(transcodeCacheStats.totalBytes)} /{' '}
                          {formatFileSize(transcodeCacheStats.maxBytes)} cap
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={isClearingTranscodeCache}
                onClick={async () => {
                  setIsClearingTranscodeCache(true);
                  try {
                    const nextStats = await ipcClient.clearTranscodeCache();
                    setTranscodeCacheStats(nextStats);
                  } finally {
                    setIsClearingTranscodeCache(false);
                  }
                }}
                className="liquid-glass-btn inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium text-white/85 hover:text-rose-300 cursor-pointer shrink-0"
              >
                <Trash2 size={12} />
                <span>{isClearingTranscodeCache ? 'Clearing...' : 'Clear cache'}</span>
              </button>
            </div>
          </div>

          {/* Section 3: Output Device Selection */}
          <div className="pt-4 border-t border-white/10">
            <div className="flex items-center gap-2 text-xs font-semibold text-white mb-2.5">
              <Speaker size={14} style={{ color: accentColor }} />
              <span>Hardware Audio Output Device</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {devices.map((dev) => {
                const isSelected = outputDeviceId === dev.deviceId;
                return (
                  <button
                    key={dev.deviceId}
                    type="button"
                    onClick={() => onChangeOutputDevice(dev.deviceId)}
                    className={`flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border text-xs text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-white/12 border-white/35 text-white font-semibold'
                        : 'bg-black/30 border-white/10 text-white/70 hover:text-white hover:border-white/20'
                    }`}
                  >
                    <span className="truncate">{dev.label}</span>
                    {isSelected && <Check size={14} style={{ color: accentColor }} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 4: 10-Band Equalizer Controls */}
          <div className="pt-4 border-t border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    onChangeEqualizer({ ...equalizer, enabled: !equalizer.enabled })
                  }
                  style={
                    equalizer.enabled ? { backgroundColor: accentColor } : undefined
                  }
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    equalizer.enabled
                      ? 'text-slate-950'
                      : 'bg-white/10 text-white/65 hover:text-white'
                  }`}
                >
                  {equalizer.enabled ? 'EQ Active' : 'EQ Bypassed'}
                </button>

                {/* Preset Pills */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {Object.keys(EQ_PRESETS).map((presetName) => (
                    <button
                      key={presetName}
                      type="button"
                      onClick={() => handlePresetChange(presetName)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        equalizer.preset === presetName
                          ? 'bg-white/20 text-white border border-white/30'
                          : 'bg-white/5 text-white/65 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      {presetName}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={handleResetEqualizer}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-white/65 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <RotateCcw size={12} />
                <span>Reset Flat</span>
              </button>
            </div>

            {/* Live SVG Frequency Curve Preview */}
            <div className="w-full rounded-xl bg-black/40 border border-white/10 p-3 mb-4">
              <svg
                viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                className="w-full h-20 overflow-visible"
              >
                {/* 0dB center reference line */}
                <line
                  x1="20"
                  y1={svgHeight / 2}
                  x2={svgWidth - 20}
                  y2={svgHeight / 2}
                  stroke="rgba(255,255,255,0.15)"
                  strokeDasharray="4 4"
                />
                <polyline
                  fill="none"
                  stroke={equalizer.enabled ? accentColor : 'rgba(255,255,255,0.3)'}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={points}
                />
                {equalizer.bands.map((gain, i) => {
                  const x = (i / 9) * (svgWidth - 40) + 20;
                  const y = svgHeight / 2 - (gain / 12) * (svgHeight / 2 - 12);
                  return (
                    <circle
                      key={i}
                      cx={x}
                      cy={y}
                      r="4"
                      fill={equalizer.enabled ? accentColor : '#6B7280'}
                    />
                  );
                })}
              </svg>
            </div>

            {/* Preamp + 10 Vertical Band Sliders */}
            <div className="grid grid-cols-11 gap-2 items-center bg-black/30 border border-white/10 rounded-xl p-4">
              {/* Preamp Column */}
              <div className="flex flex-col items-center pr-2 border-r border-white/10">
                <span className="text-[10px] font-mono tabular-nums text-white/70 mb-2">
                  {equalizer.preamp > 0 ? `+${equalizer.preamp.toFixed(1)}` : equalizer.preamp.toFixed(1)}dB
                </span>
                <div className="h-32 flex items-center justify-center">
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    disabled={!equalizer.enabled}
                    value={equalizer.preamp}
                    onChange={(e) =>
                      onChangeEqualizer({
                        ...equalizer,
                        preamp: parseFloat(e.target.value),
                      })
                    }
                    className="w-28 -rotate-90 accent-indigo-400 cursor-pointer"
                  />
                </div>
                <span className="text-[11px] font-medium text-white/80 mt-2">Preamp</span>
              </div>

              {/* 10 Frequency Bands */}
              {EQ_FREQUENCY_LABELS.map((label, idx) => {
                const val = equalizer.bands[idx] ?? 0;
                return (
                  <div key={label} className="flex flex-col items-center">
                    <span className="text-[10px] font-mono tabular-nums text-white/70 mb-2">
                      {val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1)}
                    </span>
                    <div className="h-32 flex items-center justify-center">
                      <input
                        type="range"
                        min={-12}
                        max={12}
                        step={0.5}
                        disabled={!equalizer.enabled}
                        value={val}
                        onChange={(e) =>
                          handleBandChange(idx, parseFloat(e.target.value))
                        }
                        className="w-28 -rotate-90 accent-indigo-400 cursor-pointer"
                      />
                    </div>
                    <span className="text-[11px] font-mono text-white/65 mt-2">
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 5: Spotify Canvas Looping Video Background */}
          <div className="pt-4 border-t border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-white/5 border border-white/10 mt-0.5">
                  <Film size={16} style={{ color: accentColor }} />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white">
                    Spotify Canvas Background Videos
                  </div>
                  <p className="text-[11px] text-white/60 mt-0.5 max-w-md">
                    Display looping Spotify Canvas videos in the Now Playing view. Falls back to
                    blurred, slowly moving album art if disabled or unavailable.
                  </p>
                  {canvasStats && (
                    <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums text-white/50 mt-1.5">
                      <span>{canvasStats.fileCount} cached videos</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {formatFileSize(canvasStats.totalBytes)} / {formatFileSize(canvasStats.maxBytes)} cap
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {canvasStats && canvasStats.fileCount > 0 && (
                  <button
                    type="button"
                    disabled={isClearingCanvas}
                    onClick={async () => {
                      setIsClearingCanvas(true);
                      try {
                        const next = await ipcClient.clearCanvasCache();
                        setCanvasStats(next);
                      } finally {
                        setIsClearingCanvas(false);
                      }
                    }}
                    className="liquid-glass-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-white/75 hover:text-rose-300 cursor-pointer"
                  >
                    <Trash2 size={12} />
                    <span>Clear Video Cache</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onChangeCanvasEnabled(!canvasEnabled)}
                  style={canvasEnabled ? { backgroundColor: accentColor } : undefined}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                    canvasEnabled
                      ? 'text-slate-950'
                      : 'bg-white/10 text-white/65 hover:text-white'
                  }`}
                >
                  {canvasEnabled ? 'Canvas Enabled' : 'Canvas Off'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
