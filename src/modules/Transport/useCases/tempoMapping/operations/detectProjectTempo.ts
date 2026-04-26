import { trackStore } from '#/modules/Arrangement/stores';

import { type TempoMapPoint, type TempoMapResult } from '../../../models/TempoMappingTypes';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';

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

    const averageBpm = maxBin.reduce((alpha, b) => alpha + b, 0) / maxBin.length;

    const points: TempoMapPoint[] = [];
    let currentBeat = 0;

    for (let index = 0; index < bpmEstimates.length; index++) {
        const neighbors = bpmEstimates.slice(Math.max(0, index - 2), index + 3);
        const smoothedBpm = neighbors.reduce((alpha, b) => alpha + b, 0) / neighbors.length;
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
            for (let time = 0; time < clipDuration; time += beatDuration) {
                onsets.push(clipStartSec + time);
            }
        }
    }

    return onsets.sort((alpha, b) => alpha - b);
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
