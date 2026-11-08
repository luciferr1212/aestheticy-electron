import React, { useEffect, useState } from 'react';
import {
  Disc3,
  Mic2,
  Film,
  Radio,
  FileAudio,
  FolderPlus,
} from 'lucide-react';

export const WELCOME_STORAGE_KEY = 'aestheticy.welcomeSeen';

interface WelcomeModalProps {
  isOpen: boolean;
  accentColor: string;
  onChooseMusicFolder: () => void;
  onSkip: () => void;
}

const FEATURES = [
  {
    icon: Mic2,
    title: 'Word-by-word synced lyrics',
    description:
      'Apple Music-style syllable-timed karaoke lyrics with Romanization and offline LRC support.',
  },
  {
    icon: Film,
    title: 'Spotify Canvas backgrounds',
    description:
      'Looping visual backdrops in Now Playing with dynamic album art color refraction.',
  },
  {
    icon: Radio,
    title: 'Jam (listen together in sync)',
    description:
      'Peer-to-peer WebRTC listening rooms with clock sync and live host audio fallback.',
  },
  {
    icon: FileAudio,
    title: 'Wide format support',
    description:
      'Play MP3, FLAC, WAV, AAC, ALAC, OGG, OPUS, WMA, AIFF, APE and more with FFmpeg fallback.',
  },
];

export const WelcomeModal: React.FC<WelcomeModalProps> = ({
  isOpen,
  accentColor,
  onChooseMusicFolder,
  onSkip,
}) => {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
      return () => cancelAnimationFrame(raf);
    } else {
      setIsVisible(false);
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, 280);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!shouldRender) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-modal-title"
      className={`fixed top-10 inset-x-0 bottom-0 z-40 flex items-center justify-center p-6 bg-black/65 backdrop-blur-xl transition-opacity duration-300 ease-out ${
        isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div
        className={`relative w-full max-w-xl rounded-3xl liquid-glass-elevated specular-surface border border-white/15 shadow-[0_28px_80px_rgba(0,0,0,0.72)] p-8 transition-all duration-300 ease-out ${
          isVisible
            ? 'opacity-100 scale-100 translate-y-0'
            : 'opacity-0 scale-95 translate-y-2'
        }`}
      >
        {/* Top App Icon & Heading */}
        <div className="flex flex-col items-center text-center">
          <div
            className="w-16 h-16 rounded-2xl liquid-glass flex items-center justify-center border border-white/20 shadow-xl mb-5"
            style={{
              boxShadow: `0 12px 36px -8px ${accentColor}45`,
            }}
          >
            <Disc3 size={34} style={{ color: accentColor }} />
          </div>

          <h1
            id="welcome-modal-title"
            className="text-2xl font-bold tracking-tight text-white font-display"
          >
            Welcome to Aestheticy
          </h1>
          <p className="mt-2 text-sm text-white/70 max-w-md">
            A liquid glass player for the music you already own
          </p>
        </div>

        {/* 2x2 Feature Cards Grid */}
        <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FEATURES.map((feat) => {
            const Icon = feat.icon;
            return (
              <div
                key={feat.title}
                className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 flex items-start gap-3.5"
              >
                <div
                  className="w-9 h-9 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center shrink-0 mt-0.5"
                  style={{ color: accentColor }}
                >
                  <Icon size={17} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-xs font-bold text-white leading-snug">
                    {feat.title}
                  </h2>
                  <p className="text-[11px] text-white/60 mt-1 leading-relaxed">
                    {feat.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Actions: Primary CTA + Skip Link */}
        <div className="mt-8 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={onChooseMusicFolder}
            style={{ backgroundColor: accentColor, color: '#090A0F' }}
            className="w-full sm:w-auto min-w-[240px] px-6 py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-xl hover:opacity-95 transition-opacity cursor-pointer"
          >
            <FolderPlus size={16} />
            <span>Choose your music folder</span>
          </button>

          <button
            type="button"
            onClick={onSkip}
            className="text-xs font-medium text-white/55 hover:text-white transition-colors py-1 px-3 cursor-pointer"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
};
