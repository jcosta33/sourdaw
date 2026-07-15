export type MonoBuffer = Float32Array;
export type StereoBuffer = [Float32Array, Float32Array];

export type EnvelopeSpec = {
    attack?: number;
    decay?: number;
    sustain?: number;
    sustainLevel?: number;
    release?: number;
    curve?: 'linear' | 'exp';
};

export type BiquadSpec = {
    type: 'lowpass' | 'highpass' | 'bandpass' | 'peaking' | 'lowshelf' | 'highshelf';
    freq: number;
    q?: number;
    gainDb?: number;
};
