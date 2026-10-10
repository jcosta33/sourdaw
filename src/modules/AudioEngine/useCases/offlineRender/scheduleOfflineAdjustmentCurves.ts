import { type AdjustmentLayer } from '#/modules/Arrangement/stores';
import { PAN_SCALE_MAX, clampFaderGain, toStereoPan } from '#/utils/audioLevelLaw';

import { makeSecondsToBeat } from '../../repositories/offlineScheduler/makeSecondsToBeat';

import { resolveTrackAdjustmentComposition, type OfflineTrackAdjustmentComposition } from './offlineAdjustmentLayers';

/**
 * Sample a track's *moving* volume/pan adjustment composition onto the strip's
 * fader and panner, one value per slew tick across the render.
 *
 * A composition that is constant across the render folds into the strip seed
 * instead (the offline mirror of live's composed fader write); this path is
 * for one that moves — a region layer riding its fades. Live rewrites the
 * composed value every scheduler tick (`sharedAdjustmentLayerApplier` →
 * `setTrackGain`/`setTrackPan`); the block walk is that write's offline grain.
 * The values are absolute fader/panner levels, so where a gain or pan lane
 * also drives the parameter the two timelines share the AudioParam the way
 * live's two writers share the strip node — the more frequent block samples
 * carry the moving layer, the lane's own points still land where they are.
 */
export function scheduleOfflineAdjustmentCurves(input: {
    layers: readonly AdjustmentLayer[];
    trackId: string;
    allTrackIds: readonly string[];
    composition: OfflineTrackAdjustmentComposition;
    trackGainNode: { gain: AudioParam };
    trackPanNode: { pan: AudioParam };
    baseGain: number;
    basePan: number;
    vcaMultiplier: number;
    durationSeconds: number;
    regionStartBeat: number;
    tickSeconds: number;
    defaultTempo: number;
    changes: ReadonlyArray<{ beat: number; tempo: number }>;
    compensationDelaySec: number;
}): void {
    if (input.composition.constant) {
        return;
    }
    const { trackGainNode, trackPanNode } = input;
    const secondsToBeat = makeSecondsToBeat(input.defaultTempo, input.changes);
    const compositionAtBeat = (beat: number): OfflineTrackAdjustmentComposition =>
        resolveTrackAdjustmentComposition({
            layers: input.layers,
            trackId: input.trackId,
            allTrackIds: input.allTrackIds,
            spanStartBeat: beat,
            spanEndBeat: beat,
        });
    const composedPanStored = (beat: number): number => {
        const panOffset = compositionAtBeat(beat).panOffset;
        return Math.max(-PAN_SCALE_MAX, Math.min(PAN_SCALE_MAX, input.basePan + panOffset));
    };
    const composedGain = (beat: number): number =>
        clampFaderGain(input.baseGain * input.vcaMultiplier * compositionAtBeat(beat).gainMultiplier);
    // The layer curves ride the same compensated clock the gain and pan lanes
    // ride (M-038), with the same region-start seed re-anchored at 0.
    const writeTime = (timeSeconds: number): number => timeSeconds + input.compensationDelaySec;
    if (input.compensationDelaySec > 0) {
        trackGainNode.gain.setValueAtTime(composedGain(input.regionStartBeat), 0);
        trackPanNode.pan.setValueAtTime(toStereoPan(composedPanStored(input.regionStartBeat)), 0);
    }
    for (let timeSeconds = 0; timeSeconds < input.durationSeconds; timeSeconds += input.tickSeconds) {
        const beat = input.regionStartBeat + secondsToBeat(timeSeconds);
        trackGainNode.gain.setValueAtTime(composedGain(beat), writeTime(timeSeconds));
        trackPanNode.pan.setValueAtTime(toStereoPan(composedPanStored(beat)), writeTime(timeSeconds));
    }
}
