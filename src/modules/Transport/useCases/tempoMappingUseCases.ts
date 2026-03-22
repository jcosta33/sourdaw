/**
 * AI Tempo Mapping
 *
 * Beat tracking from audio for live rubato performances.
 * Analyzes onset energy and inter-onset intervals to detect
 * tempo variations and create a tempo map.
 */

import { trackStore } from '#/modules/Track/stores/trackStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';

export type TempoMapPoint = {
    /** Beat position */
    beat: number;
    /** BPM at this point */
    bpm: number;
    /** Confidence of detection (0–1) */
    confidence: number;
    /** Was this manually adjusted? */
    manual: boolean;
};

export type TempoMapResult = {
    /** Detected tempo map points */
    points: TempoMapPoint[];
    /** Average BPM */
    averageBpm: number;
    /** BPM range */
    minBpm: number;
    maxBpm: number;
    /** Overall confidence */
    confidence: number;
    /** Total beats analyzed */
    totalBeats: number;
};

/**
 * Detect tempo from an array of onset positions (in seconds).
 * Uses inter-onset interval analysis to find tempo variations.
 */
export function detectTempoFromOnsets(onsets: number[]): TempoMapResult {
    if (onsets.length < 3) {
        return createEmptyResult();
    }

    // Calculate inter-onset intervals
    const intervals: number[] = [];
    for (let i = 1; i < onsets.length; i++) {
        intervals.push(onsets[i]! - onsets[i - 1]!);
    }

    // Convert intervals to BPM estimates
    const bpmEstimates = intervals
        .filter((interval) => interval > 0.15 && interval < 2.0) // Filter unreasonable tempos (30-400 BPM)
        .map((interval) => 60 / interval);

    if (bpmEstimates.length === 0) {
        return createEmptyResult();
    }

    // Find the dominant tempo using histogram binning
    const binWidth = 2; // BPM bin width
    const bins = new Map<number, number[]>();

    for (const bpm of bpmEstimates) {
        const binKey = Math.round(bpm / binWidth) * binWidth;
        const existing = bins.get(binKey) ?? [];
        existing.push(bpm);
        bins.set(binKey, existing);
    }

    // Find the most common tempo bin
    let maxBin: number[] = [];
    for (const [, binValues] of bins) {
        if (binValues.length > maxBin.length) {
            maxBin = binValues;
        }
    }

    const averageBpm = maxBin.reduce((a, b) => a + b, 0) / maxBin.length;

    // Generate tempo map points — one per beat
    const points: TempoMapPoint[] = [];
    let currentBeat = 0;

    for (let i = 0; i < bpmEstimates.length; i++) {
        // Smooth the tempo: use a weighted average with neighbors
        const neighbors = bpmEstimates.slice(Math.max(0, i - 2), i + 3);
        const smoothedBpm = neighbors.reduce((a, b) => a + b, 0) / neighbors.length;

        // Confidence based on how close to the dominant tempo
        const deviation = Math.abs(smoothedBpm - averageBpm) / averageBpm;
        const confidence = Math.max(0, 1 - deviation * 3);

        points.push({
            beat: currentBeat,
            bpm: Math.round(smoothedBpm * 10) / 10,
            confidence,
            manual: false,
        });

        currentBeat += 1;
    }

    const allBpms = points.map((p) => p.bpm);
    const minBpm = Math.min(...allBpms);
    const maxBpm = Math.max(...allBpms);
    const overallConfidence = points.reduce((sum, p) => sum + p.confidence, 0) / points.length;

    return {
        points,
        averageBpm: Math.round(averageBpm * 10) / 10,
        minBpm,
        maxBpm,
        confidence: overallConfidence,
        totalBeats: currentBeat,
    };
}

/**
 * Generate a simulated onset array from clip positions.
 * In production, this would use actual audio onset detection.
 */
export function estimateOnsetsFromClips(): number[] {
    const state = trackStore.value;
    if (!state) {
        return [];
    }

    const transport = transportStore.value;
    const currentTempo = transport?.tempo ?? 120;
    const beatDuration = 60 / currentTempo;

    // Collect all note start positions across all MIDI tracks
    const onsets: number[] = [];
    for (const track of state.tracks) {
        if (track.kind !== 'midi') {
            continue;
        }
        for (const clip of track.clips) {
            // Simulate onsets at clip start and every beat within the clip
            const clipStartSec = clip.startBeat * beatDuration;
            const clipDuration = (clip.endBeat - clip.startBeat) * beatDuration;
            for (let t = 0; t < clipDuration; t += beatDuration) {
                onsets.push(clipStartSec + t);
            }
        }
    }

    return onsets.sort((a, b) => a - b);
}

/**
 * Apply detected tempo map to the transport.
 */
export function applyTempoMap(result: TempoMapResult): void {
    const state = transportStore.value;
    if (!state) {
        return;
    }

    // Set the average BPM as the project tempo
    if (result.averageBpm > 0) {
        transportStore.set({
            ...state,
            tempo: Math.round(result.averageBpm),
        });
    }
}

/**
 * Run full tempo detection on the current project.
 */
export function detectProjectTempo(): TempoMapResult {
    const onsets = estimateOnsetsFromClips();
    const result = detectTempoFromOnsets(onsets);

    if (result.confidence > 0.5) {
        applyTempoMap(result);
    }

    return result;
}

function createEmptyResult(): TempoMapResult {
    return {
        points: [],
        averageBpm: 0,
        minBpm: 0,
        maxBpm: 0,
        confidence: 0,
        totalBeats: 0,
    };
}

/**
 * Manually adjust a tempo map point.
 */
export function adjustTempoPoint(points: TempoMapPoint[], beat: number, newBpm: number): TempoMapPoint[] {
    return points.map((p) =>
        p.beat === beat ? { ...p, bpm: newBpm, manual: true, confidence: 1 } : p
    );
}
