/** Internal delivery data. Public callers derive their shapes from use cases. */
export type DeliverySettings = {
    readonly formats: readonly ('wav' | 'mp3' | 'flac')[];
    readonly sampleRate: number | 'source';
    readonly bitDepth: 16 | 24 | 32;
    readonly channels: 1 | 2;
    readonly mp3BitRate: 96 | 128 | 192 | 320;
    readonly normalization: 'off' | 'r128';
    readonly targetLufs: number;
    readonly ceilingDbTp: number;
};

export type DeliveryPreset = {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly metadataFields: readonly ('title' | 'artist' | 'description')[];
    readonly settings: DeliverySettings;
};
