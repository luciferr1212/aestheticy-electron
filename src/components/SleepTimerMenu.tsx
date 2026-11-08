import React, { useEffect, useRef, useState } from 'react';
import { Moon } from 'lucide-react';

export type SleepTimerChoice = number | 'end-of-track' | null;

interface SleepTimerMenuProps {
  accentColor: string;
  /** e.g. "12:34", "End of track", or null when no timer is running */
  activeLabel: string | null;
  onChoose: (choice: SleepTimerChoice) => void;
}

const OPTIONS: { label: string; value: SleepTimerChoice }[] = [
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '45 minutes', value: 45 },
  { label: '1 hour', value: 60 },
  { label: '2 hours', value: 120 },
  { label: 'End of current track', value: 'end-of-track' },
];

export const SleepTimerMenu: React.FC<SleepTimerMenuProps> = ({
  accentColor,
  activeLabel,
  onChoose,
}) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Sleep Timer"
        style={activeLabel ? { borderColor: accentColor, color: accentColor } : undefined}
        className="liquid-glass-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium text-white/85 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Moon size={14} />
        {activeLabel && <span className="font-mono tabular-nums text-[11px]">{activeLabel}</span>}
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-52 rounded-2xl liquid-glass p-1.5 z-50 shadow-2xl">
          <p className="px-3 pt-1.5 pb-1 text-[11px] text-white/50">Pause playback after…</p>
          {OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => {
                onChoose(opt.value);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-1.5 rounded-xl text-xs text-white/85 hover:text-white hover:bg-white/10 cursor-pointer"
            >
              {opt.label}
            </button>
          ))}
          {activeLabel && (
            <button
              type="button"
              onClick={() => {
                onChoose(null);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-1.5 mt-1 rounded-xl text-xs text-rose-300 hover:bg-white/10 cursor-pointer border-t border-white/10"
            >
              Cancel timer
            </button>
          )}
        </div>
      )}
    </div>
  );
};
