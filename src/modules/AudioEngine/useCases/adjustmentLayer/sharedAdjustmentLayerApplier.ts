import { trackStore } from '#/modules/Arrangement/stores';

import { audioEngine } from '../../repositories/createWebAudioEngine';
import { adjustmentApplicationStore } from '../../stores/adjustmentApplicationStore';

import { type AppliedLayerRecord } from '../../stores/adjustmentApplicationStore';

import {
    createAdjustmentLayerApplier,
    type CreateAdjustmentLayerApplierOutput,
    type TrackGainPanApplier,
} from './adjustmentLayerApplier';

import type { AdjustmentLayerTickInput } from '../../models/AudioEngineState';

/**
 * Singleton applier wired to the real audio engine + arrangement store.
 *
 * Scope of the MVP wiring:
 *  - `volume` layers multiply the underlying postFaderGain via the engine's
 *    `setTrackGain` method. Because `setTrackGain` normally reflects the user
 *    fader position, the override is applied as `fader * layerGain` and rolled
 *    back on clear. This is a best-effort approximation of a bus insert and is
 *    documented in the spec's "known limitations".
 *  - `pan` layers follow the same pattern on the pan axis.
 *  - Other effect types (eq/compressor/reverb/delay/saturation/filter/width)
 *    are recorded to `adjustmentApplicationStore` so UI and tests can observe
 *    the active stack. Inline DSP insertion is deferred (see spec §M2).
 */

type ApplierSingleton = {
    inner: CreateAdjustmentLayerApplierOutput;
    userGainByTrack: Map<string, number>;
    userPanByTrack: Map<string, number>;
    batchAppliedRecords: AppliedLayerRecord[];
};

let singleton: ApplierSingleton | null = null;

function buildSingleton(): ApplierSingleton {
    const userGainByTrack = new Map<string, number>();
    const userPanByTrack = new Map<string, number>();
    const batchAppliedRecords: AppliedLayerRecord[] = [];

    const rememberUserGain = (trackId: string): number => {
        const existing = userGainByTrack.get(trackId);
        if (existing !== undefined) {
            return existing;
        }
        const track = trackStore.value?.tracks.find((t) => t.id === trackId);
        const gain = track?.gain ?? 1;
        userGainByTrack.set(trackId, gain);
        return gain;
    };

    const rememberUserPan = (trackId: string): number => {
        const existing = userPanByTrack.get(trackId);
        if (existing !== undefined) {
            return existing;
        }
        const track = trackStore.value?.tracks.find((t) => t.id === trackId);
        const pan = track?.pan ?? 0;
        userPanByTrack.set(trackId, pan);
        return pan;
    };

    const gainPanApplier: TrackGainPanApplier = {
        setGainOverride: (trackId, _layerId, gainLinear) => {
            const base = rememberUserGain(trackId);
            audioEngine.setTrackGain(trackId, base * gainLinear);
        },
        clearGainOverride: (trackId, _layerId) => {
            const base = rememberUserGain(trackId);
            audioEngine.setTrackGain(trackId, base);
            userGainByTrack.delete(trackId);
        },
        setPanOverride: (trackId, _layerId, pan) => {
            const base = rememberUserPan(trackId);
            audioEngine.setTrackPan(trackId, base + pan * 50);
        },
        clearPanOverride: (trackId, _layerId) => {
            const base = rememberUserPan(trackId);
            audioEngine.setTrackPan(trackId, base);
            userPanByTrack.delete(trackId);
        },
    };

    const inner = createAdjustmentLayerApplier({
        gainPanApplier,
        getAllTrackIds: () => (trackStore.value?.tracks ?? []).map((t) => t.id),
        onApplied: (record) => {
            batchAppliedRecords.push(record);
        },
    });

    return { inner, userGainByTrack, userPanByTrack, batchAppliedRecords };
}

function ensureSingleton(): ApplierSingleton {
    if (!singleton) {
        singleton = buildSingleton();
    }
    return singleton;
}

function toEngineTick(records: AppliedLayerRecord[]): AdjustmentLayerTickInput[] {
    const inputs: AdjustmentLayerTickInput[] = [];
    for (const rec of records) {
        if (rec.effectType === 'volume' || rec.effectType === 'pan') {
            continue;
        }
        inputs.push({
            trackId: rec.trackId,
            layerId: rec.layerId,
            effectType: rec.effectType,
            parameters: rec.parameters,
            blend: rec.blend,
        });
    }
    return inputs;
}

export function getSharedAdjustmentLayerApplier(): CreateAdjustmentLayerApplierOutput {
    const holder = ensureSingleton();
    return {
        applyLayers: (args) => {
            holder.batchAppliedRecords.length = 0;
            const result = holder.inner.applyLayers(args);
            adjustmentApplicationStore.set({ applied: holder.batchAppliedRecords.slice() });
            audioEngine.applyAdjustmentLayerTick?.(toEngineTick(result));
            return result;
        },
        reset: () => {
            holder.inner.reset();
            holder.userGainByTrack.clear();
            holder.userPanByTrack.clear();
            holder.batchAppliedRecords.length = 0;
            adjustmentApplicationStore.set({ applied: [] });
            audioEngine.resetAdjustmentLayers?.();
        },
    };
}

export function resetSharedAdjustmentLayerApplierForTest(): void {
    singleton = null;
    adjustmentApplicationStore.set({ applied: [] });
}
