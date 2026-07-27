import { modulationStore } from '#/modules/Automation/stores';
import { removeMapping, removeModulator } from '#/modules/Automation/useCases';
import { runAllEffects } from '#/utils/runEffects';

type RemoveTrackModulationReferencesInput = {
    deferRuntimeEffects?: boolean;
    trackId: string;
};

type DeferredModulationRemoval = {
    afterCommit: () => void;
    afterAmbiguousCommit: () => void;
};

export function removeTrackModulationReferences({
    deferRuntimeEffects = false,
    trackId,
}: RemoveTrackModulationReferencesInput): DeferredModulationRemoval {
    const modulationState = modulationStore.value;
    if (!modulationState) {
        return {
            afterCommit: () => undefined,
            afterAmbiguousCommit: () => undefined,
        };
    }

    const ownedIds = modulationState.modulators
        .filter((modulator) => modulator.trackId === trackId)
        .map(({ id }) => id);
    const crossTrackMappings = modulationState.modulators
        .filter((modulator) => modulator.trackId !== trackId)
        .flatMap((modulator) =>
            modulator.mappings
                .filter((mapping) => mapping.targetTrackId === trackId)
                .map((mapping) => ({
                    modulatorId: modulator.id,
                    targetTrackId: mapping.targetTrackId,
                    targetDeviceId: mapping.targetDeviceId,
                    targetParamId: mapping.targetParamId,
                }))
        );
    const deferredRuntimeEffects: Array<{ finalize: () => void; remainsRemoved: () => boolean }> = [];

    for (const id of ownedIds) {
        const deferredRuntimeEffect = removeModulator(id, { deferRuntimeEffects });
        if (deferredRuntimeEffect) {
            deferredRuntimeEffects.push({
                finalize: deferredRuntimeEffect,
                remainsRemoved: () => !modulationStore.value?.modulators.some((modulator) => modulator.id === id),
            });
        }
    }
    for (const { modulatorId, ...target } of crossTrackMappings) {
        const deferredRuntimeEffect = removeMapping(modulatorId, target, { deferRuntimeEffects });
        if (deferredRuntimeEffect) {
            deferredRuntimeEffects.push({
                finalize: deferredRuntimeEffect,
                remainsRemoved: () => {
                    const current = modulationStore.value?.modulators.find((modulator) => modulator.id === modulatorId);
                    return !current?.mappings.some(
                        (mapping) =>
                            mapping.targetTrackId === target.targetTrackId &&
                            mapping.targetDeviceId === target.targetDeviceId &&
                            mapping.targetParamId === target.targetParamId
                    );
                },
            });
        }
    }

    return {
        afterCommit: () => runAllEffects(deferredRuntimeEffects.map(({ finalize }) => finalize)),
        afterAmbiguousCommit: () =>
            runAllEffects(
                deferredRuntimeEffects.filter(({ remainsRemoved }) => remainsRemoved()).map(({ finalize }) => finalize)
            ),
    };
}
