import type { WasmDecodedAudio } from './helpers';

/**
 * Convert interleaved f32 PCM from the WASM decoder into an `AudioBuffer`
 * for Web Audio playback/scheduling.
 */
export function wasmDecodedToAudioBuffer(
    decoded: WasmDecodedAudio,
    audioContext: AudioContext | OfflineAudioContext
): AudioBuffer {
    const { interleaved, sampleRate, channels, totalFrames } = decoded;
    const buffer = audioContext.createBuffer(channels, totalFrames, sampleRate);
    for (let ch = 0; ch < channels; ch++) {
        const channelData = buffer.getChannelData(ch);
        for (let frame = 0; frame < totalFrames; frame++) {
            channelData[frame] = interleaved[frame * channels + ch] ?? 0;
        }
    }
    return buffer;
}
