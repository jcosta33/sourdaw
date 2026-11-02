export interface OpusEncodeOptions {
	sampleRate: number;
	channels?: number;
	bitrate?: number;
	application?: 'voip' | 'audio' | 'lowdelay';
	/** libopus encoder effort 0-10 (default 10) */
	complexity?: number;
	/** VorbisComment tags baked into OpusTags */
	meta?: Record<string, string | number>;
}

export interface StreamEncoder {
	encode(channels: Float32Array[]): Uint8Array;
	flush(): Uint8Array;
	free(): void;
}

export default function opus(opts: OpusEncodeOptions): Promise<StreamEncoder>;
