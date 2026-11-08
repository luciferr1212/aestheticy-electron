import React, { useCallback, useEffect, useState } from 'react';
import { Maximize, Minimize, MonitorSmartphone } from 'lucide-react';
import type { WindowInfo } from '../shared/ipcTypes.ts';
import { ipcClient } from '../services/ipcClient.ts';

const PRESETS: Array<{ label: string; w: number; h: number }> = [
  { label: 'Compact', w: 1100, h: 700 },
  { label: 'Standard', w: 1280, h: 800 },
  { label: 'Large', w: 1600, h: 900 },
  { label: 'Full HD', w: 1920, h: 1080 },
];

export const WindowSizeCard: React.FC<{ accentColor: string }> = ({ accentColor }) => {
  const [info, setInfo] = useState<WindowInfo | null>(null);
  const [w, setW] = useState('');
  const [h, setH] = useState('');

  const refresh = useCallback(async () => {
    try {
      setInfo(await ipcClient.getWindowInfo());
    } catch {
      setInfo(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('resize', refresh);
    return () => window.removeEventListener('resize', refresh);
  }, [refresh]);

  const apply = async (width: number, height: number) => {
    setInfo(await ipcClient.setWindowSize(width, height));
  };

  return (
    <div className="p-4 rounded-xl bg-black/30 border border-white/10 space-y-3">
      <div className="flex items-start gap-2.5">
        <MonitorSmartphone size={15} style={{ color: accentColor }} className="mt-0.5 shrink-0" />
        <div className="flex-1">
          <h3 className="text-xs font-semibold text-white">Window Size & Full Screen</h3>
          <p className="text-xs text-white/60">
            {info
              ? `Window ${info.width}×${info.height} · Screen ${info.screenWidth}×${info.screenHeight}`
              : 'Reading window size…'}
          </p>
        </div>
        <button
          type="button"
          onClick={async () => setInfo(await ipcClient.setFullScreen(!info?.isFullScreen))}
          className="liquid-glass-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white cursor-pointer shrink-0"
          title="Shortcut: F11"
        >
          {info?.isFullScreen ? <Minimize size={13} /> : <Maximize size={13} />}
          <span>{info?.isFullScreen ? 'Exit Full Screen' : 'Full Screen (F11)'}</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => apply(p.w, p.h)}
            className="liquid-glass-btn px-3 py-1.5 rounded-lg text-xs text-white/85 hover:text-white cursor-pointer"
          >
            {p.label} <span className="text-white/45 font-mono">{p.w}×{p.h}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={async () => {
            await ipcClient.maximizeOrRestoreWindow();
            await refresh();
          }}
          className="liquid-glass-btn px-3 py-1.5 rounded-lg text-xs text-white/85 hover:text-white cursor-pointer"
        >
          {info?.isMaximized ? 'Restore' : 'Maximize'}
        </button>
      </div>

      <form
        className="flex items-center gap-2 text-xs text-white/70"
        onSubmit={(e) => {
          e.preventDefault();
          const nw = parseInt(w, 10);
          const nh = parseInt(h, 10);
          if (nw > 0 && nh > 0) apply(nw, nh);
        }}
      >
        <span>Custom</span>
        <input
          value={w}
          onChange={(e) => setW(e.target.value.replace(/\D/g, ''))}
          placeholder="width"
          className="w-20 px-2 py-1 rounded-lg bg-black/35 border border-white/15 text-white focus:outline-none"
        />
        <span>×</span>
        <input
          value={h}
          onChange={(e) => setH(e.target.value.replace(/\D/g, ''))}
          placeholder="height"
          className="w-20 px-2 py-1 rounded-lg bg-black/35 border border-white/15 text-white focus:outline-none"
        />
        <button type="submit" className="liquid-glass-btn px-3 py-1 rounded-lg font-medium text-white cursor-pointer">
          Apply
        </button>
      </form>
    </div>
  );
};
