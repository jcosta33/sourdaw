import { trackStore } from '#/modules/Arrangement/stores';
import { getTransportState } from '#/modules/Transport/repositories/transport/getTransportState';
import { updateTransportState } from '#/modules/Transport/repositories/transport/updateTransportState';
import { type TempoMapPoint, type TempoMapResult } from '#/modules/Transport/models/TempoMappingTypes';

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
    for (let i = 1; i < onsets.length; i++) {
        intervals.push(onsets[i]! - onsets[i - 1]!);
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
        const existing = bins.get(binKey) ?? [];
        existing.push(bpm);
        bins.set(binKey, existing);
    }

    let maxBin: number[] = [];
    for (const [, binValues] of bins) {
        if (binValues.length > maxBin.length) {
            maxBin = binValues;
        }
    }

    const averageBpm = maxBin.reduce((a, b) => a + b, 0) / maxBin.length;

    const points: TempoMapPoint[] = [];
    let currentBeat = 0;

    for (let i = 0; i < bpmEstimates.length; i++) {
        const neighbors = bpmEstimates.slice(Math.max(0, i - 2), i + 3);
        const smoothedBpm = neighbors.reduce((a, b) => a + b, 0) / neighbors.length;
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

export function estimateOnsetsFromClips(): number[] {
    const state = trackStore.value;
    if (!state) {
        return [];
    }

    const transport = getTransportState();
    const currentTempo = transport?.tempo ?? 120;
    const beatDuration = 60 / currentTempo;

    const onsets: number[] = [];
    for (const track of state.tracks) {
        if (track.kind !== 'midi') {
            continue;
        }
        for (const clip of track.clips) {
            const clipStartSec = clip.startBeat * beatDuration;
            const clipDuration = (clip.endBeat - clip.startBeat) * beatDuration;
            for (let t = 0; t < clipDuration; t += beatDuration) {
                onsets.push(clipStartSec + t);
            }
        }
    }

    return onsets.sort((a, b) => a - b);
}

export function applyTempoMap(result: TempoMapResult): void {
    const state = getTransportState();
    if (!state) {
        return;
    }

    if (result.averageBpm > 0) {
        updateTransportState({ tempo: Math.round(result.averageBpm) });
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