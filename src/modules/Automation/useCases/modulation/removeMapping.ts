import { type ModulatorMapping } from '../../models/Modulator';
import { modulationStore } from '../../stores/modulationStore';

import { revertMappingsToBase } from './revertMappingsToBase';

/** The full identity of a mapping destination (a modulator may map the same
 * param on different tracks/devices — `targetParamId` alone is ambiguous). */
export type MappingTarget = Pick<ModulatorMapping, 'targetTrackId' | 'targetDeviceId' | 'targetParamId'>;
type RemoveMappingOptions = {
    deferRuntimeEffects?: boolean;
};

function sameTarget(mapping: ModulatorMapping, target: MappingTarget): boolean {
    return (
        mapping.targetTrackId === target.targetTrackId &&
        mapping.targetDeviceId === target.targetDeviceId &&
        mapping.targetParamId === target.targetParamId
    );
}

export function removeMapping(
    modulatorId: string,
    target: MappingTarget,
    options: RemoveMappingOptions = {}
): (() => void) | null {
    const state = modulationStore.value;
    if (!state) {
        return null;
    }

    // The engine holds the last modulated value for this param; reverting before
    // the mapping disappears restores the persisted base instead of leaving the
    // param stuck at wherever the LFO/step last drove it.
    const modulator = state.modulators.find((m) => m.id === modulatorId);
    const removed = modulator?.mappings.filter((x) => sameTarget(x, target)) ?? [];

    modulationStore.set({
        modulators: state.modulators.map((m) =>
            m.id === modulatorId ? { ...m, mappings: m.mappings.filter((x) => !sameTarget(x, target)) } : m
        ),
    });

    if (removed.length === 0) {
        return null;
    }
    let runtimeEffectsFinalized = false;
    function finalizeRuntimeEffects(): void {
        if (runtimeEffectsFinalized) {
            return;
        }
        revertMappingsToBase(removed);
        runtimeEffectsFinalized = true;
    }
    if (!options.deferRuntimeEffects) {
        finalizeRuntimeEffects();
        return null;
    }
    return finalizeRuntimeEffects;
}
