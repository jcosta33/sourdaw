import { createHandler } from '#/utils/createHandler';

import { modulationStore } from '../../stores/modulationStore';
import { addMapping } from '../../useCases/modulation/addMapping';

function sameTarget(
    mapping: { targetTrackId: string; targetDeviceId: string; targetParamId: string },
    target: { targetTrackId: string; targetDeviceId: string; targetParamId: string }
): boolean {
    return (
        mapping.targetTrackId === target.targetTrackId &&
        mapping.targetDeviceId === target.targetDeviceId &&
        mapping.targetParamId === target.targetParamId
    );
}

export const handleAddMapping = createHandler<'addMapping'>({
    execute: (action) => {
        addMapping(action.payload.modulatorId, action.payload.mapping);
        return undefined;
    },
    describe: (action) => {
        const modulator = modulationStore.value?.modulators.find((m) => m.id === action.payload.modulatorId);
        // Re-adding an existing destination is the use case's documented
        // no-op (it must not clobber a user-tuned amount), so there is no
        // inverse: undoing it must not delete the pre-existing mapping.
        const alreadyExists =
            modulator?.mappings.some((mapping) => sameTarget(mapping, action.payload.mapping)) ?? false;
        if (alreadyExists || !modulator) {
            return {
                label: modulator
                    ? `Map ${modulator.name} (${modulator.id}) to ${action.payload.mapping.targetTrackId}/${action.payload.mapping.targetDeviceId}/${action.payload.mapping.targetParamId}`
                    : 'Add modulation mapping',
                inverseAction: null,
            };
        }
        return {
            label: `Map ${modulator.name} (${modulator.id}) to ${action.payload.mapping.targetTrackId}/${action.payload.mapping.targetDeviceId}/${action.payload.mapping.targetParamId}`,
            inverseAction: {
                type: 'removeMapping',
                payload: {
                    modulatorId: action.payload.modulatorId,
                    target: {
                        targetTrackId: action.payload.mapping.targetTrackId,
                        targetDeviceId: action.payload.mapping.targetDeviceId,
                        targetParamId: action.payload.mapping.targetParamId,
                    },
                },
            },
        };
    },
    undoable: true,
});
