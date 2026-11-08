import React, { useState } from 'react';
import { Disc3 } from 'lucide-react';
import { getDeterministicPalette } from '../utils/formatters.ts';

interface CoverArtProps {
  src: string | null | undefined;
  title: string;
  subtitle?: string;
  className?: string;
  iconSize?: number;
}

export const CoverArt: React.FC<CoverArtProps> = ({
  src,
  title,
  subtitle = '',
  className = 'w-10 h-10 rounded',
  iconSize = 18,
}) => {
  const [hasError, setHasError] = useState(false);
  const [c1, c2] = getDeterministicPalette(`${title}-${subtitle}`);

  if (!src || hasError) {
    return (
      <div
        className={`relative flex items-center justify-center overflow-hidden bg-[#141724] border border-white/10 shrink-0 ${className}`}
        style={{
          backgroundImage: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`,
        }}
        aria-label={title}
      >
        <Disc3 className="text-white/45" size={iconSize} strokeWidth={1.5} />
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-[#141724] border border-white/10 shrink-0 ${className}`}>
      <img
        src={src}
        alt={`${title}${subtitle ? ` by ${subtitle}` : ''}`}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setHasError(true)}
        className="w-full h-full object-cover block"
      />
    </div>
  );
};
