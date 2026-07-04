/**
 * Use case: Track pitch over time using the pitchy library.
 */

import { PitchDetector } from 'pitchy';

import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { NOTE_NAMES } from '#/utils/noteNames';

import { type PitchResult, type PitchTrackingOptions } from './pitchDetection';

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
