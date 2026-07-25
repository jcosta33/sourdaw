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
    /**
     * Semitone range `pitchBend` is expressed in, resolved by the caller
     * (audit MD-8). Required whenever `pitchBend` is set: the raw wire delta
     * carries no depth, and this module deliberately holds no default of its
     * own — a second copy of the MPE ±48 constant here is exactly how the live
     * and playback paths drifted apart.
     */
    pitchBendRangeSemitones?: number;
};
