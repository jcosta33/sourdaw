/**
 * Use case: Pitch detection using the pitchy library.
 *
 * Uses the McLeod Pitch Method (MPM) for high-quality monophonic pitch
 * detection. Much more accurate than the custom autocorrelation approach
 * in audioToMidi.ts.
 *
 * License: MIT (safe for commercial use).
 */

import { PitchDetector } from 'pitchy';

import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { NOTE_NAMES } from '#/utils/noteNames';

// ── Types ───────────────────────────────────────────────────────────────

export type PitchResult = {
    timeSec: number;
    frequency: number;
    midiPitch: number;
    noteName: string;
    clarity: number;
};

export type PitchTrackingOptions = {
    /** Window size in samples for each pitch estimate (default 2048) */
    windowSize?: number;
    /** Hop size in samples between windows (default 512) */
    hopSize?: number;
    /** Minimum clarity threshold 0-1 to include a pitch (default 0.8) */
    clarityThreshold?: number;
    /** Minimum volume in dB to include a pitch (default -40) */
    minVolumeDb?: number;
};

// ── Core detection ──────────────────────────────────────────────────────

function freqToMidi(freq: number): number {
    return Math.round(69 + 12 * Math.log2(freq / 440));
}

function freqToNoteName(freq: number): string {
    const midi = freqToMidi(freq);
    const note = NOTE_NAMES[midi % 12]!;
    const octave = Math.floor(midi / 12) - 1;
    return `${note}${String(octave)}`;
}

/**
 * Track pitch over time for an audio buffer using the McLeod Pitch Method.
 * Returns an array of detected pitches with timestamps, frequencies, and quality.
 */
export function trackPitch(audioBufferId: string, options: PitchTrackingOptions = {}): PitchResult[] {
    const { windowSize = 2048, hopSize = 512, clarityThreshold = 0.8, minVolumeDb = -40 } = options;

    const buffer = audioBufferCache.get(audioBufferId);
    if (!buffer) {
        return [];
    }

    const data = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const detector = PitchDetector.forFloat32Array(windowSize);
    detector.minVolumeDecibels = minVolumeDb;

    const results: PitchResult[] = [];
    const window = new Float32Array(windowSize);

    for (let offset = 0; offset + windowSize <= data.length; offset += hopSize) {
        // Copy windowed segment
        for (let index = 0; index < windowSize; index++) {
            window[index] = data[offset + index]!;
        }

        const [frequency, clarity] = detector.findPitch(window, sampleRate);

        if (clarity >= clarityThreshold && frequency > 20 && frequency < 5000) {
            results.push({
                timeSec: offset / sampleRate,
                frequency,
                midiPitch: freqToMidi(frequency),
                noteName: freqToNoteName(frequency),
                clarity,
            });
        }
    }

    return results;
}

/**
 * Detect the dominant pitch of an entire audio buffer.
 * Returns the most frequently occurring pitch.
 */
export function detectDominantPitch(audioBufferId: string, options?: PitchTrackingOptions): PitchResult | null {
    const pitches = trackPitch(audioBufferId, options);
    if (pitches.length === 0) {
        return null;
    }

    // Count MIDI pitch occurrences
    const counts = new Map<number, number>();
    for (const param of pitches) {
        counts.set(param.midiPitch, (counts.get(param.midiPitch) ?? 0) + 1);
    }

    // Find the most common pitch
    let maxCount = 0;
    let dominantMidi = 0;
    for (const [midi, count] of counts) {
        if (count > maxCount) {
            maxCount = count;
            dominantMidi = midi;
        }
    }

    // Return the representative sample with highest clarity
    return pitches
        .filter((param) => param.midiPitch === dominantMidi)
        .reduce((best, param) => (param.clarity > best.clarity ? param : best));
}
