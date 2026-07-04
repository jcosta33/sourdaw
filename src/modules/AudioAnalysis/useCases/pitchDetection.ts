/**
 * Use case: Pitch detection using the pitchy library.
 *
 * Uses the McLeod Pitch Method (MPM) for high-quality monophonic pitch
 * detection. Much more accurate than the custom autocorrelation approach
 * in audioToMidi.ts.
 *
 * License: MIT (safe for commercial use).
 */

import { trackPitch } from './trackPitch';

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
