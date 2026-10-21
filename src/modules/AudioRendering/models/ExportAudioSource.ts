/** Borrowed PCM. A consumer must finish before the render owner admits its next buffer. */
export type ExportAudioSource = Pick<AudioBuffer, 'length' | 'numberOfChannels' | 'sampleRate' | 'getChannelData'> & {
    /** Export-only normalization, applied during quantization without rewriting borrowed PCM. */
    readonly gain?: number;
};

export type ExportByteWriter = {
    write: (bytes: Uint8Array) => Promise<void>;
    checkCancelled?: () => void;
};
