/**
 * Repository: Audio file decoding via Tauri IPC → Rust symphonia.
 *
 * Provides typed wrappers around the native audio decoding commands:
 *  - `getAudioFileInfo`  — metadata probe (no decoding)
 *  - `decodeAudioFile`   — full PCM f32 decode
 *  - `generateWaveformPeaks` — mipmap peak data for waveform rendering
 *
 * All functions gracefully degrade in browser-only mode by returning
 * null / empty results so UI code doesn't need platform guards.
 */

import { isTauri, tauriInvoke } from '#/helpers/tauriBridge';

// ── Types ───────────────────────────────────────────────────────────────

export type AudioFileInfo = {
    path: string;
    name: string;
    sampleRate: number;
    channels: number;
    durationMs: number;
    totalFrames: number;
    codec: string;
    sizeBytes: number;
};

export type DecodedAudio = {
    samples: number[];
    sampleRate: number;
    channels: number;
    durationMs: number;
    totalFrames: number;
};

export type WaveformPeak = {
    min: number;
    max: number;
};

// ── Rust ↔ TS key mapping helpers ───────────────────────────────────────

type RustAudioFileInfo = {
    path: string;
    name: string;
    sample_rate: number;
    channels: number;
    duration_ms: number;
    total_frames: number;
    codec: string;
    size_bytes: number;
};

type RustDecodedAudio = {
    samples: number[];
    sample_rate: number;
    channels: number;
    duration_ms: number;
    total_frames: number;
};

function mapFileInfo(raw: RustAudioFileInfo): AudioFileInfo {
    return {
        path: raw.path,
        name: raw.name,
        sampleRate: raw.sample_rate,
        channels: raw.channels,
        durationMs: raw.duration_ms,
        totalFrames: raw.total_frames,
        codec: raw.codec,
        sizeBytes: raw.size_bytes,
    };
}

function mapDecodedAudio(raw: RustDecodedAudio): DecodedAudio {
    return {
        samples: raw.samples,
        sampleRate: raw.sample_rate,
        channels: raw.channels,
        durationMs: raw.duration_ms,
        totalFrames: raw.total_frames,
    };
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Probe an audio file for metadata without decoding.
 * Returns null when running outside Tauri.
 */
export async function getAudioFileInfo(path: string): Promise<AudioFileInfo | null> {
    if (!isTauri()) {
        return null;
    }
    const raw = (await tauriInvoke('get_audio_file_info', { path })) as RustAudioFileInfo;
    return mapFileInfo(raw);
}

/**
 * Decode an audio file into interleaved f32 PCM samples.
 *
 * ⚠️  For large files this can be a significant amount of data —
 * prefer `getAudioFileInfo` for metadata-only queries and
 * `generateWaveformPeaks` for waveform rendering.
 *
 * Returns null when running outside Tauri.
 */
export async function decodeAudioFile(path: string): Promise<DecodedAudio | null> {
    if (!isTauri()) {
        return null;
    }
    const raw = (await tauriInvoke('decode_audio_file', { path })) as RustDecodedAudio;
    return mapDecodedAudio(raw);
}

/**
 * Convert decoded audio samples to an AudioBuffer for Web Audio API playback.
 *
 * Useful when you need to play back decoded PCM data through the Web Audio graph.
 */
export function samplesToAudioBuffer(
    decoded: DecodedAudio,
    audioContext: AudioContext | OfflineAudioContext
): AudioBuffer {
    const { samples, sampleRate, channels, totalFrames } = decoded;
    const buffer = audioContext.createBuffer(channels, totalFrames, sampleRate);

    // De-interleave: samples is [L R L R …], we need per-channel arrays
    for (let ch = 0; ch < channels; ch++) {
        const channelData = buffer.getChannelData(ch);
        for (let frame = 0; frame < totalFrames; frame++) {
            channelData[frame] = samples[frame * channels + ch] ?? 0;
        }
    }

    return buffer;
}
