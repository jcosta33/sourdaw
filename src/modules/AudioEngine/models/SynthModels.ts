/**
 * Model: Synthesizer parameter types and defaults.
 * Defines the shape of synth parameters used across the audio engine.
 */

export type SynthParams = {
    waveform: 'sine' | 'triangle' | 'sawtooth' | 'square';
    attack: number;
    decay: number;
    sustain: number;
    release: number;
    filterCutoff: number;
    filterResonance: number;
    filterType: 'lowpass' | 'highpass' | 'bandpass';
    filterEnvAmount: number; // Hz offset: filter starts at cutoff+amount, decays to cutoff
    detune: number;
    gain: number;
    // Extended parameters for richer timbres
    osc2Waveform: 'sine' | 'triangle' | 'sawtooth' | 'square';
    osc2Detune: number; // cents detune for osc2 relative to osc1
    osc2Mix: number; // 0 = only osc1, 1 = only osc2, 0.5 = equal
    subOscLevel: number; // 0-1, level of sub-oscillator (one octave below)
    noiseLevel: number; // 0-1, level of noise layer
    // Modulation and spatial
    vibratoRate: number; // Hz, LFO speed for pitch vibrato (0 = off)
    vibratoDepth: number; // cents, amplitude of pitch vibrato
    vibratoDelay: number; // seconds, delay before vibrato kicks in (more natural)
    stereoSpread: number; // 0-1, pans osc1 left and osc2 right
    // Velocity sensitivity
    filterVelocitySensitivity: number; // 0-1, how much velocity opens the filter
};

export const defaultSynthParams: SynthParams = {
    waveform: 'sawtooth',
    attack: 0.01,
    decay: 0.2,
    sustain: 0.7,
    release: 0.3,
    filterCutoff: 5000,
    filterResonance: 1,
    filterType: 'lowpass',
    filterEnvAmount: 0,
    detune: 0,
    gain: 0.3,
    osc2Waveform: 'sawtooth',
    osc2Detune: 0,
    osc2Mix: 0,
    subOscLevel: 0,
    noiseLevel: 0,
    vibratoRate: 0,
    vibratoDepth: 0,
    vibratoDelay: 0.3,
    stereoSpread: 0,
    filterVelocitySensitivity: 0,
};

export type MpeParams = {
    pressure?: number;
    slide?: number;
    pitchBend?: number;
};

export type DrumKitVoice = {
    name: string;
    pitchRange: [number, number];
    params: SynthParams;
};

export type DrumKit = {
    id: string;
    name: string;
    voices: DrumKitVoice[];
};
