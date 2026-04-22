import { type AdjustmentLayer } from '#/modules/Arrangement/stores';

import { type AppliedLayerRecord } from '../../stores/adjustmentApplicationStore';

/**
 * Runtime application of an adjustment layer to a target track at a specific beat.
 *
 * The applier holds per-(layerId, trackId) state so calls at successive scheduler
 * ticks translate into smooth parameter ramps on the underlying audio nodes.
 *
 * MVP notes:
 *  - `volume` and `pan` layers are full-fidelity: gain/pan is applied to the
 *    track strip's postFaderGain / panNode via the `TrackGainPanApplier` interface.
 *  - Other effect types (`eq`, `compressor`, `reverb`, `delay`, `saturation`,
 *    `filter`, `stereo-width`) are recorded in the active-application log but
 *    not yet wired to in-line DSP nodes. Follow-up work will build a per-track
 *    effect insert chain (see `.agents/specs/missing/adjustment-layer.md` §M2).
 */

export type TrackGainPanApplier = {
    setGainOverride: (trackId: string, layerId: string, gainLinear: number) => void;
    clearGainOverride: (trackId: string, layerId: string) => void;
    setPanOverride: (trackId: string, layerId: string, pan: number) => void;
    clearPanOverride: (trackId: string, layerId: string) => void;
};

export type { AppliedLayerRecord };

export type AdjustmentApplierDeps = {
    gainPanApplier: TrackGainPanApplier;
    /** Returns the track ids currently in the arrangement, ordered. Empty if unavailable. */
    getAllTrackIds: () => string[];
    /** Receives every applied record in order — used by tests and future DSP wiring. */
    onApplied?: (record: AppliedLayerRecord) => void;
};

type ApplierState = {
    /** Keyed by `${layerId}::${trackId}` to track which pairs are currently active
     *  so we can emit `clearGainOverride` / `clearPanOverride` on deactivation. */
    activePairs: Set<string>;
};

function pairKey(layerId: string, trackId: string): string {
    return `${layerId}::${trackId}`;
}

export type CreateAdjustmentLayerApplierOutput = {
    applyLayers: (args: { activeLayers: AdjustmentLayer[]; beat: number }) => AppliedLayerRecord[];
    reset: () => void;
};

export function createAdjustmentLayerApplier(deps: AdjustmentApplierDeps): CreateAdjustmentLayerApplierOutput {
    const state: ApplierState = { activePairs: new Set() };

    const resolveAffectedTrackIds = (layer: AdjustmentLayer): string[] => {
        if (layer.affectedTrackIds.length > 0) {
            return layer.affectedTrackIds;
        }
        const all = deps.getAllTrackIds();
        return all.slice(layer.insertionIndex);
    };

    const computeRegionBlend = (layer: AdjustmentLayer, beat: number): number => {
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
    };

    const parametersToMap = (layer: AdjustmentLayer): Record<string, number> => {
        const map: Record<string, number> = {};
        for (const p of layer.parameters) {
            map[p.name] = p.value;
        }
        return map;
    };

    const applyVolumePan = (layer: AdjustmentLayer, trackId: string, blend: number): void => {
        if (layer.effectType === 'volume') {
            const gainDb = layer.parameters.find((p) => p.name === 'Gain')?.value ?? 0;
            const target = dbToLinear(gainDb);
            const blended = 1 + (target - 1) * blend;
            deps.gainPanApplier.setGainOverride(trackId, layer.id, blended);
            return;
        }
        if (layer.effectType === 'pan') {
            const panPct = layer.parameters.find((p) => p.name === 'Pan')?.value ?? 0;
            const blended = (panPct / 100) * blend;
            deps.gainPanApplier.setPanOverride(trackId, layer.id, blended);
            return;
        }
    };

    const clearVolumePan = (layer: AdjustmentLayer, trackId: string): void => {
        if (layer.effectType === 'volume') {
            deps.gainPanApplier.clearGainOverride(trackId, layer.id);
            return;
        }
        if (layer.effectType === 'pan') {
            deps.gainPanApplier.clearPanOverride(trackId, layer.id);
            return;
        }
    };

    return {
        applyLayers: ({ activeLayers, beat }): AppliedLayerRecord[] => {
            const produced: AppliedLayerRecord[] = [];
            const newlyActive = new Set<string>();

            for (const layer of activeLayers) {
                const blend = computeRegionBlend(layer, beat);
                if (blend <= 0) {
                    continue;
                }
                const trackIds = resolveAffectedTrackIds(layer);
                for (const trackId of trackIds) {
                    const key = pairKey(layer.id, trackId);
                    newlyActive.add(key);
                    applyVolumePan(layer, trackId, blend);
                    const record: AppliedLayerRecord = {
                        layerId: layer.id,
                        trackId,
                        effectType: layer.effectType,
                        blend,
                        parameters: parametersToMap(layer),
                        beat,
                    };
                    produced.push(record);
                    deps.onApplied?.(record);
                }
            }

            for (const previousKey of state.activePairs) {
                if (newlyActive.has(previousKey)) {
                    continue;
                }
                const separator = previousKey.indexOf('::');
                if (separator === -1) {
                    continue;
                }
                const layerId = previousKey.slice(0, separator);
                const trackId = previousKey.slice(separator + 2);
                const layer = activeLayers.find((l) => l.id === layerId);
                if (layer) {
                    clearVolumePan(layer, trackId);
                } else {
                    deps.gainPanApplier.clearGainOverride(trackId, layerId);
                    deps.gainPanApplier.clearPanOverride(trackId, layerId);
                }
            }

            state.activePairs = newlyActive;
            return produced;
        },
        reset: (): void => {
            for (const previousKey of state.activePairs) {
                const separator = previousKey.indexOf('::');
                if (separator === -1) {
                    continue;
                }
                const layerId = previousKey.slice(0, separator);
                const trackId = previousKey.slice(separator + 2);
                deps.gainPanApplier.clearGainOverride(trackId, layerId);
                deps.gainPanApplier.clearPanOverride(trackId, layerId);
            }
            state.activePairs.clear();
        },
    };
}

function dbToLinear(db: number): number {
    return Math.pow(10, db / 20);
}
