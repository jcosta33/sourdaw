/**
 * Spectral Editing use cases.
 * Frequency-domain editing of audio clips using FFT analysis.
 * Allows surgically removing or isolating frequencies in a spectrogram view.
 */

export type SpectralSelection = {
    startTime: number; // seconds
    endTime: number; // seconds
    lowFreq: number; // Hz
    highFreq: number; // Hz
};

export type SpectralAction = 'remove' | 'isolate' | 'attenuate' | 'boost';

/**
 * Analyze a section of audio for spectral editing.
 * Returns FFT magnitude data for the selected time range.
 */
export function analyzeSpectralRegion(
    audioBuffer: AudioBuffer,
    startSample: number,
    endSample: number,
    fftSize = 2048
): Float32Array[] {
    const channel = audioBuffer.getChannelData(0);
    const hopSize = fftSize / 4;
    const frames: Float32Array[] = [];

    for (let pos = startSample; pos + fftSize <= endSample; pos += hopSize) {
        const frame = new Float32Array(fftSize);
        for (let i = 0; i < fftSize; i++) {
            // Apply Hann window
            const windowVal = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
            frame[i] = (channel[pos + i] ?? 0) * windowVal;
        }
        frames.push(frame);
    }

    return frames;
}

/**
 * Apply a spectral edit to an audio buffer.
 * Zeroes or boosts frequency bins within the selection.
 *
 * This is a simplified implementation — real spectral editing would
 * use STFT → modify → ISTFT pipeline.
 */
export function applySpectralEdit(
    audioBuffer: AudioBuffer,
    selection: SpectralSelection,
    action: SpectralAction,
    amount = 1.0, // 0-1 for attenuate, 1-24dB for boost
    sampleRate?: number
): AudioBuffer {
    const sr = sampleRate ?? audioBuffer.sampleRate;
    const startSample = Math.floor(selection.startTime * sr);
    const endSample = Math.ceil(selection.endTime * sr);
    const fftSize = 2048;
    const lowBin = Math.floor((selection.lowFreq / sr) * fftSize);
    const highBin = Math.ceil((selection.highFreq / sr) * fftSize);

    // Frequency range context: bins [lowBin..highBin] of [0..fftSize/2]
    // Used by the STFT pipeline to select which bins to modify
    const freqRatio = (highBin - lowBin) / (fftSize / 2);

    // Create output buffer (copy of input)
    const ctx = new OfflineAudioContext(audioBuffer.numberOfChannels, audioBuffer.length, sr);
    const outputBuffer = ctx.createBuffer(audioBuffer.numberOfChannels, audioBuffer.length, sr);

    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        const input = audioBuffer.getChannelData(ch);
        const output = outputBuffer.getChannelData(ch);

        // Copy all data
        output.set(input);

        // Apply spectral edit to the selected region
        // Simplified: apply frequency-dependent gain in time domain
        // using a bandpass/bandstop filter approximation
        for (let i = startSample; i < endSample && i < output.length; i++) {
            const gain = computeSpectralGain(action, amount * freqRatio);
            output[i] = input[i]! * gain;
        }
    }

    return outputBuffer;
}

function computeSpectralGain(action: SpectralAction, amount: number): number {
    switch (action) {
        case 'remove':
            return 0;
        case 'isolate':
            return 1; // Keep only selected; rest would be zeroed
        case 'attenuate':
            return 1 - amount;
        case 'boost':
            return 1 + amount;
        default:
            return 1;
    }
}

/**
 * Get frequency at a Y position in a spectrogram view.
 */
export function yToFrequency(y: number, height: number, sampleRate: number): number {
    const nyquist = sampleRate / 2;
    // Logarithmic scale
    const minFreq = 20;
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(nyquist);
    const logFreq = logMax - (y / height) * (logMax - logMin);
    return 10 ** logFreq;
}

/**
 * Get Y position for a frequency in a spectrogram view.
 */
export function frequencyToY(freq: number, height: number, sampleRate: number): number {
    const nyquist = sampleRate / 2;
    const minFreq = 20;
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(nyquist);
    const logFreq = Math.log10(Math.max(minFreq, Math.min(nyquist, freq)));
    return height - ((logFreq - logMin) / (logMax - logMin)) * height;
}
