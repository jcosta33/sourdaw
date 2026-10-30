/** Borrowed PCM. A consumer must finish before the render owner admits its next buffer. */
type ExportPcmShape = {
    readonly length: number;
    readonly numberOfChannels: number;
    readonly sampleRate: number;
    /** Export-only normalization, applied during quantization without rewriting borrowed PCM. */
    readonly gain?: number;
    /** Raw finite sample peak, measured before gain by the complete target pass. */
    readonly samplePeak?: number;
};

export type ExportAudioSource = ExportPcmShape &
    (
        | { getChannelData: (channel: number) => Float32Array; readChannels?: never }
        | { readChannels: (start: number, length: number) => readonly Float32Array[]; getChannelData?: never }
    );

export type ExportByteWriter = {
    write: (bytes: Uint8Array) => Promise<void>;
    checkCancelled?: () => void;
};
