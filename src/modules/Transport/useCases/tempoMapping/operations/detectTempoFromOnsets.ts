import { type TempoMapPoint, type TempoMapResult } from '../../../models/TempoMappingTypes';

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
 * Detect tempo from an array of onset positions (in seconds).
 */
export function detectTempoFromOnsets(onsets: number[]): TempoMapResult {
    if (onsets.length < 3) {
        return createEmptyResult();
    }

    const intervals: number[] = [];
    for (let index = 1; index < onsets.length; index++) {
        intervals.push(onsets[index]! - onsets[index - 1]!);
    }

    const bpmEstimates = intervals
        .filter((interval) => interval > 0.15 && interval < 2.0)
        .map((interval) => 60 / interval);

    if (bpmEstimates.length === 0) {
        return createEmptyResult();
    }

    const binWidth = 2;
    const bins = new Map<number, number[]>();

    for (const bpm of bpmEstimates) {
        const binKey = Math.round(bpm / binWidth) * binWidth;
        if (!bins.has(binKey)) {
            bins.set(binKey, []);
        }
        bins.get(binKey)!.push(bpm);
    }

    let maxBin: number[] = [];
    for (const [, binValues] of bins) {
        if (binValues.length > maxBin.length) {
            maxBin = binValues;
        }
    }

    const averageBpm = maxBin.reduce((alpha, bpm) => alpha + bpm, 0) / maxBin.length;

    const points: TempoMapPoint[] = [];
    let currentBeat = 0;

    // Centered moving average over a window of up to 5 estimates (index-2 .. index+2),
    // clamped at both ends. Maintain the window's running sum incrementally so each
    // frame is O(1) rather than slicing + reducing the whole neighborhood (O(N^2)).
    const estimateCount = bpmEstimates.length;
    let windowLow = 0; // inclusive
    let windowHigh = 0; // exclusive
    let windowSum = 0;

    for (let index = 0; index < estimateCount; index++) {
        const desiredLow = Math.max(0, index - 2);
        const desiredHigh = Math.min(estimateCount, index + 3);

        while (windowHigh < desiredHigh) {
            windowSum += bpmEstimates[windowHigh]!;
            windowHigh++;
        }
        while (windowLow < desiredLow) {
            windowSum -= bpmEstimates[windowLow]!;
            windowLow++;
        }

        const windowSize = windowHigh - windowLow;
        const smoothedBpm = windowSum / windowSize;
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

    const allBpms = points.map((param) => param.bpm);
    const minBpm = Math.min(...allBpms);
    const maxBpm = Math.max(...allBpms);
    const overallConfidence = points.reduce((sum, param) => sum + param.confidence, 0) / points.length;

    return {
        points,
        averageBpm: Math.round(averageBpm * 10) / 10,
        minBpm,
        maxBpm,
        confidence: overallConfidence,
        totalBeats: currentBeat,
    };
}
