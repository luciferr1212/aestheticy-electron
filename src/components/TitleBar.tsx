import React, { useEffect, useState } from 'react';
import {
  Minus,
  Square,
  Copy,
  X,
  Sliders,
  PictureInPicture2,
  Disc3,
  Maximize,
  Minimize,
} from 'lucide-react';
import { ipcClient } from '../services/ipcClient.ts';

interface TitleBarProps {
  isPlaying: boolean;
  isMiniPlayer: boolean;
  equalizerEnabled: boolean;
  onToggleMiniPlayer: () => void;
  onOpenSettings: () => void;
  accentColor: string;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  isPlaying,
  isMiniPlayer,
  equalizerEnabled,
  onToggleMiniPlayer,
  onOpenSettings,
  accentColor,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => {
    const sync = () => {
      ipcClient
        .getWindowInfo()
        .then((info) => {
          setIsFullScreen(info.isFullScreen);
          setIsMaximized(info.isMaximized);
        })
        .catch(() => {});
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  const handleFullScreen = async () => {
    const info = await ipcClient.setFullScreen(!isFullScreen);
    setIsFullScreen(info.isFullScreen);
  };

  const handleMinimize = async () => {
    await ipcClient.minimizeWindow();
  };

  const handleMaximizeRestore = async () => {
    const res = await ipcClient.maximizeOrRestoreWindow();
    setIsMaximized(res.isMaximized);
  };

  const handleClose = async () => {
    await ipcClient.closeWindow();
  };

  return (
    <header className="app-drag-region relative z-50 h-10 shrink-0 px-4 flex items-center justify-between gap-8 select-none">
      {/* Zone 1: Brand Title (Single-line wordmark) */}
      <div className="flex items-center gap-2.5 shrink-0">
        <Disc3
          size={16}
          style={{ color: accentColor }}
          className={isPlaying ? 'animate-spin' : ''}
        />
        <span className="text-sm font-bold tracking-tight text-white/95 font-display whitespace-nowrap shrink-0">
          Aestheticy
        </span>
      </div>

      {/* Zone 2: Quick Workspace Mode & Audio Controls */}
      <div className="app-no-drag hidden md:flex items-center gap-2 text-xs text-white/70">
        <button
          type="button"
          onClick={onOpenSettings}
          className="liquid-glass-btn px-3 py-1 rounded-lg flex items-center gap-1.5 text-xs font-medium text-white/85 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
          title="Audio Output & 10-Band Equalizer Settings"
        >
          <Sliders size={13} style={{ color: equalizerEnabled ? accentColor : undefined }} />
          <span>Equalizer & Output</span>
        </button>

        <button
          type="button"
          onClick={onToggleMiniPlayer}
          className="liquid-glass-btn px-3 py-1 rounded-lg flex items-center gap-1.5 text-xs font-medium text-white/85 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
          title="Toggle Compact Liquid Glass Mini Player"
        >
          <PictureInPicture2
            size={13}
            style={{ color: isMiniPlayer ? accentColor : undefined }}
          />
          <span>{isMiniPlayer ? 'Full Window' : 'Mini Player'}</span>
        </button>
      </div>

      {/* Zone 3: Frameless Window Caption Controls */}
      <div className="app-no-drag flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={handleFullScreen}
          title={isFullScreen ? 'Exit Full Screen (F11)' : 'Full Screen (F11)'}
          className="w-8 h-7 rounded-md flex items-center justify-center text-white/65 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          {isFullScreen ? <Minimize size={13} /> : <Maximize size={13} />}
        </button>
        <button
          type="button"
          onClick={handleMinimize}
          title="Minimize"
          className="w-8 h-7 rounded-md flex items-center justify-center text-white/65 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          onClick={handleMaximizeRestore}
          title={isMaximized ? 'Restore' : 'Maximize'}
          className="w-8 h-7 rounded-md flex items-center justify-center text-white/65 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          {isMaximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button
          type="button"
          onClick={handleClose}
          title="Close Window"
          className="w-8 h-7 rounded-md flex items-center justify-center text-white/65 hover:text-white hover:bg-rose-500/80 transition-colors cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
};
