export type WasmDecodedAudio = {
    /** Interleaved samples: [L0, R0, L1, R1, …]. */
    interleaved: Float32Array;
    sampleRate: number;
    channels: number;
    totalFrames: number;
};
