import type { EqualizerSettings } from '../shared/ipcTypes.ts';

export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export const EQ_FREQUENCY_LABELS = [
  '32',
  '64',
  '125',
  '250',
  '500',
  '1k',
  '2k',
  '4k',
  '8k',
  '16k',
] as const;

export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass Boost': [6.5, 5.5, 4.0, 2.0, 0.5, 0, 0, 0.5, 1.0, 1.5],
  'Electronic / Club': [5.0, 4.5, 2.0, 0, -1.5, 1.5, 1.0, 2.5, 4.0, 4.5],
  'Vocal Presence': [-2.0, -1.5, -0.5, 1.5, 4.0, 5.0, 4.0, 2.0, 0.5, 0],
  'Warm Analog': [3.5, 3.0, 2.0, 1.0, 0.5, 0, -1.0, -1.5, -2.0, -2.5],
  'Late Night': [4.0, 3.0, 1.0, 0, -1.0, 0, 1.5, 2.5, 3.0, 2.0],
  'Treble Sparkle': [0, 0, 0, 0.5, 1.0, 2.0, 3.5, 5.0, 6.0, 6.5],
  'Acoustic Studio': [3.0, 2.5, 1.0, 0.5, 1.5, 1.5, 2.5, 3.5, 3.0, 2.0],
};

class WebAudioEqualizerEngine {
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private preampNode: GainNode | null = null;
  private filterNodes: BiquadFilterNode[] = [];
  private streamDestNode: MediaStreamAudioDestinationNode | null = null;
  private attachedElement: HTMLAudioElement | null = null;
  private currentSettings: EqualizerSettings = {
    enabled: true,
    preset: 'Flat',
    preamp: 0,
    bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
  private normalizationGainDb = 0;
  private crossfadeMultiplier = 1.0;

  public attachToAudioElement(audioEl: HTMLAudioElement, settings: EqualizerSettings): void {
    this.currentSettings = settings;
    if (this.attachedElement === audioEl && this.audioCtx) {
      this.applySettings(settings);
      return;
    }

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass();
      }

      if (this.attachedElement !== audioEl) {
        this.sourceNode = this.audioCtx.createMediaElementSource(audioEl);
        this.preampNode = this.audioCtx.createGain();
        this.streamDestNode = this.audioCtx.createMediaStreamDestination();

        this.filterNodes = EQ_FREQUENCIES.map((freq, index) => {
          const filter = this.audioCtx!.createBiquadFilter();
          if (index === 0) {
            filter.type = 'lowshelf';
          } else if (index === EQ_FREQUENCIES.length - 1) {
            filter.type = 'highshelf';
          } else {
            filter.type = 'peaking';
            filter.Q.value = 1.4;
          }
          filter.frequency.value = freq;
          filter.gain.value = 0;
          return filter;
        });

        // Chain: source -> preamp -> band[0] -> ... -> band[9] -> destination & WebRTC stream destination
        this.sourceNode.connect(this.preampNode);
        let prevNode: AudioNode = this.preampNode;
        for (const filter of this.filterNodes) {
          prevNode.connect(filter);
          prevNode = filter;
        }
        prevNode.connect(this.audioCtx.destination);
        prevNode.connect(this.streamDestNode);
        this.attachedElement = audioEl;
      }

      this.applySettings(settings);
    } catch {
      // Ignore if element was already attached in strict mode
    }
  }

  public getCaptureStream(): MediaStream | null {
    if (this.streamDestNode?.stream) {
      return this.streamDestNode.stream;
    }
    if (this.attachedElement && typeof (this.attachedElement as any).captureStream === 'function') {
      try {
        return (this.attachedElement as any).captureStream();
      } catch {
        return null;
      }
    }
    return null;
  }

  public resumeContextIfNeeded(): void {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  public setNormalizationGainDb(gainDb: number): void {
    this.normalizationGainDb = Number.isFinite(gainDb) ? Math.max(-12, Math.min(12, gainDb)) : 0;
    this.updateCombinedGain();
  }

  public setCrossfadeMultiplier(multiplier: number): void {
    this.crossfadeMultiplier = Number.isFinite(multiplier)
      ? Math.max(0, Math.min(1, multiplier))
      : 1.0;
    this.updateCombinedGain();
  }

  private updateCombinedGain(): void {
    if (!this.audioCtx || !this.preampNode) return;
    const eqPreampDb = this.currentSettings.enabled
      ? Math.max(-12, Math.min(12, this.currentSettings.preamp || 0))
      : 0;
    const totalDb = eqPreampDb + this.normalizationGainDb;
    const linearGain = Math.pow(10, totalDb / 20) * this.crossfadeMultiplier;
    this.preampNode.gain.setTargetAtTime(linearGain, this.audioCtx.currentTime, 0.025);
  }

  public applySettings(settings: EqualizerSettings): void {
    this.currentSettings = settings;
    if (!this.audioCtx || !this.preampNode || this.filterNodes.length !== 10) return;

    this.updateCombinedGain();

    if (!settings.enabled) {
      for (const filter of this.filterNodes) {
        filter.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.015);
      }
      return;
    }

    for (let i = 0; i < 10; i++) {
      const bandGain = Math.max(-12, Math.min(12, settings.bands[i] ?? 0));
      this.filterNodes[i].gain.setTargetAtTime(bandGain, this.audioCtx.currentTime, 0.015);
    }
  }
}

export const equalizerEngine = new WebAudioEqualizerEngine();
