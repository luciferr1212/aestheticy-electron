import React from 'react';

/**
 * Provides SVG optical displacement and specular refraction filters (`#liquid-edge-refraction`
 * and `#liquid-glass-lens`) used by the Liquid Glass player bar, buttons, and floating sheets.
 */
export const LiquidRefractionDefs: React.FC = () => {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none fixed top-0 left-0 w-0 h-0 opacity-0 overflow-hidden"
    >
      <defs>
        {/* Subtle edge-lensing displacement filter for floating glass bars & buttons */}
        <filter id="liquid-edge-refraction" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.018 0.045"
            numOctaves="2"
            seed="7"
            result="noise"
          />
          <feGaussianBlur in="noise" stdDeviation="1.8" result="smoothedNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="smoothedNoise"
            scale="3.5"
            xChannelSelector="R"
            yChannelSelector="G"
            result="displaced"
          />
          <feSpecularLighting
            in="smoothedNoise"
            surfaceScale="2.2"
            specularConstant="0.55"
            specularExponent="28"
            lightingColor="#ffffff"
            result="specular"
          >
            <fePointLight x="240" y="-80" z="160" />
          </feSpecularLighting>
          <feComposite
            in="specular"
            in2="SourceAlpha"
            operator="in"
            result="maskedSpecular"
          />
          <feBlend in="displaced" in2="maskedSpecular" mode="screen" />
        </filter>
        {/* Real lens refraction: edge-weighted displacement map (rounded-rect, stretched to the element).
            Used through `backdrop-filter: url(#liquid-lens)` in Full effects mode only. */}
        <filter
          id="liquid-lens"
          x="0"
          y="0"
          width="100%"
          height="100%"
          primitiveUnits="objectBoundingBox"
          colorInterpolationFilters="sRGB"
        >
          <feImage
            href="data:image/png;base64,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"
            x="0"
            y="0"
            width="1"
            height="1"
            preserveAspectRatio="none"
            result="lensMap"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="lensMap"
            scale="0.24"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
};
