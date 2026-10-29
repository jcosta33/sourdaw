/** Borrowed PCM. A consumer must finish before the render owner admits its next buffer. */
export type ExportAudioSource = {
    readonly length: number;
    readonly numberOfChannels: number;
    readonly sampleRate: number;
    getChannelData: (channel: number) => Float32Array;
    /** Export-only normalization, applied during quantization without rewriting borrowed PCM. */
    readonly gain?: number;
};

export type ExportByteWriter = {
    write: (bytes: Uint8Array) => Promise<void>;
    checkCancelled?: () => void;
};
