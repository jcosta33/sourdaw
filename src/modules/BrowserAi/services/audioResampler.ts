/**
 * Service: Audio resampling utilities.
 *
 * Resamples Float32Array PCM audio to 44.1 kHz using OfflineAudioContext,
 * following the same pattern as browserStemSeparation.ts.
 */

const TARGET_SAMPLE_RATE = 44100;

type ResampleInput = {
    audio: Float32Array;
    fromSampleRate: number;
    channels?: number;
};

/**
 * Resample PCM audio to 44.1 kHz via OfflineAudioContext.
 * Returns a new Float32Array at 44.1 kHz.
 */
export async function resampleTo44100({ audio, fromSampleRate, channels = 1 }: ResampleInput): Promise<Float32Array> {
    if (fromSampleRate === TARGET_SAMPLE_RATE) {
        return audio;
    }

    const ratio = TARGET_SAMPLE_RATE / fromSampleRate;
    const outputLength = Math.round(audio.length * ratio);
    const ctx = new OfflineAudioContext(channels, outputLength, TARGET_SAMPLE_RATE);

    const audioBuffer = ctx.createBuffer(channels, audio.length, fromSampleRate);
    // Ensure we have a plain Float32Array<ArrayBuffer> (copyToChannel requires this)
    audioBuffer.copyToChannel(new Float32Array(audio), 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.start();

    const rendered = await ctx.startRendering();
    return rendered.getChannelData(0);
}


/**
 * Apply a simple fade-in/fade-out at phrase boundaries to avoid clicks.
 * Mutates the input array in-place for performance.
 */
export function applyFades(audio: Float32Array, fadeSamples: number): void {
    const fadeLen = Math.min(fadeSamples, Math.floor(audio.length / 2));
    for (let i = 0; i < fadeLen; i++) {
        const gain = i / fadeLen;
        audio[i] = (audio[i] ?? 0) * gain;
        const endIdx = audio.length - 1 - i;
        audio[endIdx] = (audio[endIdx] ?? 0) * gain;
    }
}

/**
 * Normalize audio to prevent clipping (peak normalization).
 * Mutates in-place.
 */
export function normalizePeak(audio: Float32Array): void {
    let peak = 0;
    for (const sample of audio) {
        const abs = Math.abs(sample);
        if (abs > peak) {
            peak = abs;
        }
    }
    if (peak > 0 && peak !== 1) {
        const scale = 1 / peak;
        for (let i = 0; i < audio.length; i++) {
            audio[i] = (audio[i] ?? 0) * scale;
        }
    }
}

/**
 * Convert MIDI note number to frequency in Hz.
 * MIDI 69 (A4) = 440 Hz.
 */
export function midiToHz(midiNote: number): number {
    return 440 * 2 ** ((midiNote - 69) / 12);
}

/**
 * Convert MIDI velocity (0–127) to loudness in dB.
 * Velocity 0 = silence (~-120 dB), velocity 127 = 0 dB.
 */
export function velocityToDb(velocity: number): number {
    if (velocity <= 0) {
        return -120;
    }
    return 20 * Math.log10(velocity / 127);
}
