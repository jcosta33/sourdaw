import { modulationStore } from '#/modules/Automation/stores';
import { removeMapping, removeModulator } from '#/modules/Automation/useCases';
import { runAllEffects } from '#/utils/runEffects';

type RemoveTrackModulationReferencesInput = {
    deferRuntimeEffects?: boolean;
    trackId: string;
};

export function removeTrackModulationReferences({
    deferRuntimeEffects = false,
    trackId,
}: RemoveTrackModulationReferencesInput): () => void {
    const modulationState = modulationStore.value;
    if (!modulationState) {
        return () => undefined;
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
    const deferredRuntimeEffects: Array<() => void> = [];

    for (const id of ownedIds) {
        const deferredRuntimeEffect = removeModulator(id, { deferRuntimeEffects });
        if (deferredRuntimeEffect) {
            deferredRuntimeEffects.push(deferredRuntimeEffect);
        }
    }
    for (const { modulatorId, ...target } of crossTrackMappings) {
        const deferredRuntimeEffect = removeMapping(modulatorId, target, { deferRuntimeEffects });
        if (deferredRuntimeEffect) {
            deferredRuntimeEffects.push(deferredRuntimeEffect);
        }
    }

    return () => runAllEffects(deferredRuntimeEffects);
}
