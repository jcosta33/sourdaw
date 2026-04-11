import { type DecodedAudio } from './tauriDecoding/decodeAudioFile';

/**
 * Convert decoded audio samples to an AudioBuffer for Web Audio API playback.
 * De-interleaves: samples is [L R L R …], we need per-channel arrays.
 */
export function samplesToAudioBuffer(
    decoded: DecodedAudio,
    audioContext: AudioContext | OfflineAudioContext
): AudioBuffer {
    const { samples, sampleRate, channels, totalFrames } = decoded;
    const buffer = audioContext.createBuffer(channels, totalFrames, sampleRate);

    for (let ch = 0; ch < channels; ch++) {
        const channelData = buffer.getChannelData(ch);
        for (let frame = 0; frame < totalFrames; frame++) {
            channelData[frame] = samples[frame * channels + ch] ?? 0;
        }
    }

    return buffer;
}
