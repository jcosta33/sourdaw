import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

export type DecodedAudio = {
    samples: number[];
    sampleRate: number;
    channels: number;
    durationMs: number;
    totalFrames: number;
};

type RustDecodedAudio = {
    samples: number[];
    sample_rate: number;
    channels: number;
    duration_ms: number;
    total_frames: number;
};

function mapDecodedAudio(raw: RustDecodedAudio): DecodedAudio {
    return {
        samples: raw.samples,
        sampleRate: raw.sample_rate,
        channels: raw.channels,
        durationMs: raw.duration_ms,
        totalFrames: raw.total_frames,
    };
}

/**
 * Decode an audio file into interleaved f32 PCM samples.
 * Returns null when running outside Tauri.
 */
export async function decodeAudioFile(path: string): Promise<DecodedAudio | null> {
    if (!isTauri()) {
        return null;
    }
    const raw = (await tauriInvoke('decode_audio_file', { path })) as RustDecodedAudio;
    return mapDecodedAudio(raw);
}