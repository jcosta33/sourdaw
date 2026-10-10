import { type AdjustmentLayer } from '#/modules/Arrangement/stores';
import { PAN_SCALE_MAX, dbToGain } from '#/utils/audioLevelLaw';

/**
 * The offline resolution of one track's adjustment-layer composition.
 *
 * Live applies layers once per scheduler tick: `scheduleAdjustmentLayers`
 * resolves the active stack at the playhead, `adjustmentLayerApplier` turns
 * each layer into a blended override — `applyVolumePan` for volume/pan, an
 * `AppliedLayerRecord` for every DSP type — and `sharedAdjustmentLayerApplier`
 * composes the overrides onto the strip (`composedGain` multiplies the fader,
 * `composedPan` adds in stored pan units) while `AdjustmentLayerRuntime`
 * routes the track's output through a wet/dry bus per DSP layer.
 *
 * An offline render has no ticks, so the same laws are evaluated here once per
 * track over the render's beat span: a composition that does not move across
 * the span folds into the strip's fader and panner seed via
 * `composeOfflineStripLevel` exactly as live's composed write would; one that
 * moves is sampled per scheduling block by `scheduleOfflineAdjustmentCurves`.
 * Every formula below cites its live site.
 */

/** One DSP layer's resolved plan — the record `AdjustmentLayerRuntime.applyTick` consumes. */
export type OfflineAdjustmentDspLayerPlan = {
    layerId: string;
    effectType: AdjustmentLayer['effectType'];
    parameters: Record<string, number>;
    blend: number;
};

export type OfflineTrackAdjustmentComposition = {
    /**
     * Product of every active volume layer's blended override — the factor
     * live's `composedGain` multiplies the fader by (`1 + (dbToLinear(Gain) − 1) × blend`).
     */
    gainMultiplier: number;
    /** Every active pan layer's blended offset, in stored pan units (±{@link PAN_SCALE_MAX}). */
    panOffset: number;
    /** Active DSP layers in project stack order — the order `AdjustmentLayerRuntime` chains buses in. */
    dsp: OfflineAdjustmentDspLayerPlan[];
    /**
     * Whether the whole composition is constant across the span. A constant
     * composition folds into the strip seed; a moving one needs per-block
     * samples, which only the Web Audio render schedules.
     */
    constant: boolean;
};

/** The tracks a layer reaches: its explicit list, or every track below its stack position (live `resolveAffectedTrackIds`). */
function affectsTrack(layer: AdjustmentLayer, trackId: string, allTrackIds: readonly string[]): boolean {
    if (layer.affectedTrackIds.length > 0) {
        return layer.affectedTrackIds.includes(trackId);
    }
    return allTrackIds.slice(layer.insertionIndex).includes(trackId);
}

/**
 * Live `adjustmentLayerApplier.computeRegionBlend`: regions active at the beat,
 * each `blend × envelope` (trapezoid over the fades), summed, × `mix`, clamped
 * to [0, 1]. A layer with no regions is `mix` everywhere.
 */
function layerBlendAtBeat(layer: AdjustmentLayer, beat: number): number {
    if (!layer.enabled) {
        return 0;
    }
    if (layer.regions.length === 0) {
        return Math.max(0, Math.min(1, layer.mix));
    }
    let total = 0;
    for (const region of layer.regions) {
        if (beat < region.startBeat || beat >= region.endBeat) {
            continue;
        }
        const fadeIn = Math.max(0, region.fadeInBeats);
        const fadeOut = Math.max(0, region.fadeOutBeats);
        let envelope = 1;
        if (fadeIn > 0 && beat < region.startBeat + fadeIn) {
            envelope = (beat - region.startBeat) / fadeIn;
        } else if (fadeOut > 0 && beat > region.endBeat - fadeOut) {
            envelope = Math.max(0, (region.endBeat - beat) / fadeOut);
        }
        total += region.blend * envelope;
    }
    return Math.max(0, Math.min(1, total * layer.mix));
}

/**
 * Whether one layer's blend is constant across `[spanStartBeat, spanEndBeat)`.
 * Exact for the cases it admits: a region must either miss the span entirely,
 * cover it whole with no fades, or the layer moves. Anything partially
 * overlapping is reported as moving — a wrong `false` would bake one beat's
 * blend across the whole render, while a wrong `true` only costs the render
 * its seed fold and schedules the (identical) curve instead.
 */
function layerBlendConstantAcrossSpan(layer: AdjustmentLayer, spanStartBeat: number, spanEndBeat: number): boolean {
    if (layer.regions.length === 0) {
        return true;
    }
    for (const region of layer.regions) {
        const intersectStart = Math.max(region.startBeat, spanStartBeat);
        const intersectEnd = Math.min(region.endBeat, spanEndBeat);
        if (intersectStart >= intersectEnd) {
            continue;
        }
        const coversWholeSpan =
            region.startBeat <= spanStartBeat &&
            region.endBeat >= spanEndBeat &&
            region.fadeInBeats === 0 &&
            region.fadeOutBeats === 0;
        if (!coversWholeSpan) {
            return false;
        }
    }
    return true;
}

/** Live `applyVolumePan`'s volume override for one layer at a blend. */
function volumeLayerOverride(layer: AdjustmentLayer, blend: number): number {
    const gainDb = layer.parameters.find((parameter) => parameter.name === 'Gain')?.value ?? 0;
    return 1 + (dbToGain(gainDb) - 1) * blend;
}

/** Live `applyVolumePan`'s pan override for one layer at a blend, in −1..1 units. */
function panLayerOffset(layer: AdjustmentLayer, blend: number): number {
    const panPct = layer.parameters.find((parameter) => parameter.name === 'Pan')?.value ?? 0;
    return (panPct / 100) * blend;
}

/**
 * Resolve one track's composition over the render span. `gainMultiplier` and
 * `panOffset` are evaluated at `spanStartBeat` — exact when `constant`, the
 * seed value when not. A snapshot the caller took once (see
 * `readOfflineAdjustmentLayerSnapshot`) feeds every track of the render.
 */
export function resolveTrackAdjustmentComposition(input: {
    layers: readonly AdjustmentLayer[];
    trackId: string;
    allTrackIds: readonly string[];
    spanStartBeat: number;
    spanEndBeat: number;
}): OfflineTrackAdjustmentComposition {
    const { layers, trackId, allTrackIds, spanStartBeat, spanEndBeat } = input;
    let gainMultiplier = 1;
    let panOffset = 0;
    let constant = true;
    const dsp: OfflineAdjustmentDspLayerPlan[] = [];

    // Project stack order: the applier walks the layers array, and
    // `AdjustmentLayerRuntime` chains buses in that order (#4603).
    for (const layer of layers) {
        if (!layer.enabled || !affectsTrack(layer, trackId, allTrackIds)) {
            continue;
        }
        const layerConstant = layerBlendConstantAcrossSpan(layer, spanStartBeat, spanEndBeat);
        constant = constant && layerConstant;
        const blend = layerBlendAtBeat(layer, spanStartBeat);
        if (layer.effectType === 'volume') {
            gainMultiplier *= volumeLayerOverride(layer, blend);
            continue;
        }
        if (layer.effectType === 'pan') {
            panOffset += panLayerOffset(layer, blend) * PAN_SCALE_MAX;
            continue;
        }
        dsp.push({
            layerId: layer.id,
            effectType: layer.effectType,
            parameters: Object.fromEntries(layer.parameters.map((parameter) => [parameter.name, parameter.value])),
            blend,
        });
    }

    panOffset = Math.max(-PAN_SCALE_MAX, Math.min(PAN_SCALE_MAX, panOffset));
    return { gainMultiplier, panOffset, dsp, constant };
}
