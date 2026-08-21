/**
 * Service: Audio resampling utilities.
 *
 * Resamples Float32Array PCM audio to 44.1 kHz using OfflineAudioContext.
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
    for (let index = 0; index < fadeLen; index++) {
        const gain = index / fadeLen;
        audio[index] = (audio[index] ?? 0) * gain;
        const endIdx = audio.length - 1 - index;
        audio[endIdx] = (audio[endIdx] ?? 0) * gain;
    }
}

/**
 * Normalize audio to prevent clipping (peak normalization).
 * Mutates in-place.
 */
export function normalizePeak(audio: Float32Array): void {
    let peak = 0;
    for (let index = 0; index < audio.length; index++) {
        const sample = audio[index]!;
        if (!Number.isFinite(sample)) {
            // NaN/±Infinity never compare greater-than, so they would otherwise
            // leave peak at 0 (no normalization) and stay in the output. Clamp to
            // silence so a single bad sample can't poison the whole buffer.
            audio[index] = 0;
            continue;
        }
        const abs = Math.abs(sample);
        if (abs > peak) {
            peak = abs;
        }
    }
    // peak is finite by construction (non-finite samples were zeroed above); the
    // Number.isFinite guard is belt-and-suspenders against a future change.
    if (Number.isFinite(peak) && peak > 0 && peak !== 1) {
        const scale = 1 / peak;
        for (let index = 0; index < audio.length; index++) {
            audio[index]! *= scale;
        }
    }
}

/**
 * Preserve checkpoint dynamics unless the rendered signal would clip.
 * Non-finite model output is made silent before the peak is measured.
 */
export function limitPeak(audio: Float32Array): void {
    let peak = 0;
    for (let index = 0; index < audio.length; index += 1) {
        const sample = audio[index]!;
        if (!Number.isFinite(sample)) {
            audio[index] = 0;
            continue;
        }
        peak = Math.max(peak, Math.abs(sample));
    }
    if (peak <= 1) {
        return;
    }
    const scale = 1 / peak;
    for (let index = 0; index < audio.length; index += 1) {
        audio[index]! *= scale;
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
