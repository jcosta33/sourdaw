import { audioEngine } from '../repositories/audioEngineInstance';
import { audioBufferCache } from '../stores/audioBufferCache';

/**
 * Check if running inside Tauri desktop shell.
 */
function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window;
}

/**
 * Decode audio file, preferring Tauri/symphonia for broader codec support (OGG, FLAC, AAC on WebKit).
 * Falls back to Web Audio decodeAudioData in browser environments.
 */
export async function decodeAudioFile(file: File): Promise<{ id: string; buffer: AudioBuffer }> {
    const arrayBuffer = await file.arrayBuffer();

    if (isTauri()) {
        try {
            // Use Rust symphonia for cross-platform codec consistency
            const { invoke } = await import('@tauri-apps/api/core');
            const result = (await invoke('decode_audio_file', {
                fileBytes: Array.from(new Uint8Array(arrayBuffer)),
            })) as {
                sample_rate: number;
                channels: number;
                samples: number[][];
                duration_seconds: number;
                codec: string;
            };

            const ctx = audioEngine.context;
            const buffer = ctx.createBuffer(
                result.channels,
                result.samples[0]?.length ?? 0,
                result.sample_rate
            );
            for (let ch = 0; ch < result.channels; ch++) {
                const channelData = result.samples[ch];
                if (channelData) {
                    buffer.getChannelData(ch).set(new Float32Array(channelData));
                }
            }

            const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            audioBufferCache.set(id, buffer);
            return { id, buffer };
        } catch {
            // Fallback to Web Audio if Tauri command fails
        }
    }

    // Web Audio fallback
    const buffer = await audioEngine.context.decodeAudioData(arrayBuffer);
    const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    audioBufferCache.set(id, buffer);
    return { id, buffer };
}

export function generateSyntheticBuffer(
    durationSeconds: number,
    sampleRate = 44100
): { id: string; buffer: AudioBuffer } {
    const ctx = audioEngine.context;
    const length = Math.ceil(durationSeconds * sampleRate);
    const buffer = ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            data[i] = Math.sin(2 * Math.PI * 220 * t) * 0.3 * Math.exp(-t * 0.5);
        }
    }

    const id = `synth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    audioBufferCache.set(id, buffer);
    return { id, buffer };
}
