import { trackStore } from '../stores/trackStore';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { addMidiNote } from '#/modules/MIDI/useCases';
import { addTrack } from './addTrack';
import { addClip } from '#/modules/Arrangement/useCases/clip/addClip';
import { summarizeFeatures } from '#/modules/AudioAnalysis/useCases';

export const detectKeyDependencies = {
    summarizeFeatures,
} as const;

export const audioToMidiDependencies = {
    addTrack,
    addClip,
    addMidiNote,
} as const;

function getBufferForClip(clipId: string): { buffer: AudioBuffer; audioBufferId: string } | null {
    const track = trackStore.value?.tracks.find((t) => t.clips.some((c) => c.id === clipId));
    if (!track) {
        return null;
    }
    const clip = track.clips.find((c) => c.id === clipId);
    if (!clip || clip.type !== 'audio' || !clip.audioBufferId) {
        return null;
    }
    const buffer = audioBufferCache.get(clip.audioBufferId);
    if (!buffer) {
        return null;
    }
    return { buffer, audioBufferId: clip.audioBufferId };
}

export async function detectTempo(clipId: string): Promise<number | null> {
    const result = getBufferForClip(clipId);
    if (!result) {
        return null;
    }
    const { buffer } = result;

    // Naive offline amplitude onset detection
    const data = buffer.getChannelData(0);
    let threshold = 0.0;

    // Find absolute max to normalize threshold
    for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]!) > threshold) {
            threshold = Math.abs(data[i]!);
        }
    }
    threshold *= 0.6; // 60% of max amplitude for onset

    const peaks: number[] = [];
    for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]!) > threshold) {
            peaks.push(i);
            i += Math.floor(buffer.sampleRate * 0.2); // Skip 200ms to avoid double triggers
        }
    }

    if (peaks.length < 2) {
        return 120;
    } // Default fallback

    const intervals = [];
    for (let i = 1; i < peaks.length; i++) {
        intervals.push((peaks[i]! - peaks[i - 1]!) / buffer.sampleRate);
    }

    // Sort intervals and take the median to avoid outlier clicks
    intervals.sort((a, b) => a - b);
    const medianInterval = intervals[Math.floor(intervals.length / 2)]!;

    return Math.max(40, Math.min(300, Math.round(60 / medianInterval)));
}

// ── Key Detection (Krumhansl-Schmuckler algorithm) ──────────────────────

/**
 * Krumhansl-Schmuckler key profiles.
 * Twelve values per profile representing the "fit" of each pitch class
 * (C, C#, D, D#, E, F, F#, G, G#, A, A#, B) in a given key.
 */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function pearsonCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    const meanX = x.reduce((s, v) => s + v, 0) / n;
    const meanY = y.reduce((s, v) => s + v, 0) / n;

    let num = 0;
    let denX = 0;
    let denY = 0;
    for (let i = 0; i < n; i++) {
        const dx = (x[i] ?? 0) - meanX;
        const dy = (y[i] ?? 0) - meanY;
        num += dx * dy;
        denX += dx * dx;
        denY += dy * dy;
    }

    const den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : num / den;
}

function rotateArray(arr: number[], offset: number): number[] {
    const n = arr.length;
    const result: number[] = [];
    for (let i = 0; i < n; i++) {
        result.push(arr[(i + offset) % n] ?? 0);
    }
    return result;
}

export async function detectKey(clipId: string): Promise<string | null> {
    const result = getBufferForClip(clipId);
    if (!result) {
        return null;
    }

    // Use Meyda's chroma feature extraction via summarizeFeatures
    const summary = summarizeFeatures(result.audioBufferId);
    if (!summary || summary.chromaProfile.length !== 12) {
        // Fallback if Meyda analysis fails
        return 'C Major';
    }

    const chroma = summary.chromaProfile;

    // Correlate the chroma profile against all 24 major/minor key profiles
    let bestKey = 'C Major';
    let bestCorr = -Infinity;

    for (let root = 0; root < 12; root++) {
        const rotatedChroma = rotateArray(chroma, root);

        const majorCorr = pearsonCorrelation(rotatedChroma, MAJOR_PROFILE);
        if (majorCorr > bestCorr) {
            bestCorr = majorCorr;
            bestKey = `${NOTE_NAMES[root]!} Major`;
        }

        const minorCorr = pearsonCorrelation(rotatedChroma, MINOR_PROFILE);
        if (minorCorr > bestCorr) {
            bestCorr = minorCorr;
            bestKey = `${NOTE_NAMES[root]!} Minor`;
        }
    }

    return bestKey;
}

export async function audioToMidi(clipId: string): Promise<void> {
    const result = getBufferForClip(clipId);
    if (!result) {
        return;
    }
    const { buffer } = result;

    // 1. Create a new MIDI track to dump the notes into
    const newTrack = addTrack({ name: 'Extracted MIDI', kind: 'midi' });
    if (!newTrack) {
        return;
    }

    const totalDurationSecs = buffer.length / buffer.sampleRate;
    const newClip = addClip({
        trackId: newTrack.id,
        startBeat: 0,
        endBeat: totalDurationSecs * 2,
        name: 'Extracted Notes',
        type: 'midi',
    });
    if (!newClip) {
        return;
    }

    // 2. Onset detection via amplitude threshold
    const data = buffer.getChannelData(0);
    let maxAmp = 0;
    for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]!) > maxAmp) {
            maxAmp = Math.abs(data[i]!);
        }
    }
    const onsetThreshold = maxAmp * 0.4;

    const onsets: number[] = [];
    for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]!) > onsetThreshold) {
            onsets.push(i);
            i += Math.floor(buffer.sampleRate * 0.125); // 8th note skip
        }
    }

    // 3. For each onset, estimate pitch via zero-crossing frequency
    for (let i = 0; i < onsets.length; i++) {
        const onset = onsets[i]!;

        // Count zero crossings in a window to estimate frequency
        const windowSamples = Math.min(2048, data.length - onset);
        let crossings = 0;
        for (let j = onset + 1; j < onset + windowSamples; j++) {
            if ((data[j]! >= 0 && data[j - 1]! < 0) || (data[j]! < 0 && data[j - 1]! >= 0)) {
                crossings++;
            }
        }

        // Zero-crossing rate to frequency: freq ≈ (crossings / 2) * (sampleRate / windowSamples)
        const estimatedHz = (crossings / 2) * (buffer.sampleRate / windowSamples);

        // Convert Hz to MIDI pitch: MIDI = 69 + 12 * log2(freq / 440)
        // Clamp to audible/musical range (50 Hz to 4000 Hz)
        const clampedHz = Math.max(50, Math.min(4000, estimatedHz));
        const midiPitch = Math.round(69 + 12 * Math.log2(clampedHz / 440));
        const pitch = Math.max(21, Math.min(108, midiPitch)); // Piano range A0-C8

        // Calculate beat position (assuming 120 BPM = 2 beats per second)
        const timeSecs = onset / buffer.sampleRate;
        const beatPos = timeSecs * 2;

        // Estimate velocity from local amplitude
        const localAmp = Math.abs(data[onset]!);
        const velocity = Math.max(30, Math.min(127, Math.round((localAmp / maxAmp) * 127)));

        addMidiNote(newClip.id, pitch, beatPos, 0.25, velocity);
    }
}
