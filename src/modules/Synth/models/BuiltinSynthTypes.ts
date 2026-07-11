export type BuiltinSynthWaveform = 'sine' | 'triangle' | 'sawtooth' | 'square';

export type BuiltinSynthFilterType = 'lowpass' | 'highpass' | 'bandpass';

export type BuiltinSynthParams = {
    waveform: BuiltinSynthWaveform;
    attack: number;
    decay: number;
    sustain: number;
    release: number;
    filterCutoff: number;
    filterResonance: number;
    filterType: BuiltinSynthFilterType;
    filterEnvAmount: number;
    detune: number;
    gain: number;
    osc2Waveform: BuiltinSynthWaveform;
    osc2Detune: number;
    osc2Mix: number;
    subOscLevel: number;
    noiseLevel: number;
    vibratoRate: number;
    vibratoDepth: number;
    vibratoDelay: number;
    stereoSpread: number;
    filterVelocitySensitivity: number;
};

export type BuiltinSynthMpeParams = {
    pressure?: number;
    slide?: number;
    pitchBend?: number;
};
