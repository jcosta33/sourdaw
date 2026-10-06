import { createHandler } from '#/utils/createHandler';

import { modulationStore } from '../../stores/modulationStore';
import { removeMapping } from '../../useCases/modulation/removeMapping';

export const handleRemoveMapping = createHandler<'removeMapping'>({
    execute: (action) => {
        removeMapping(action.payload.modulatorId, action.payload.target);
        return undefined;
    },
    describe: (action) => {
        const prev = modulationStore.value?.modulators
            .find((modulator) => modulator.id === action.payload.modulatorId)
            ?.mappings.find(
                (mapping) =>
                    mapping.targetTrackId === action.payload.target.targetTrackId &&
                    mapping.targetDeviceId === action.payload.target.targetDeviceId &&
                    mapping.targetParamId === action.payload.target.targetParamId
            );
        if (!prev) {
            return { label: 'Remove modulation mapping' };
        }
        return {
            label: `Remove modulation mapping to ${prev.targetTrackId}/${prev.targetDeviceId}/${prev.targetParamId}`,
            // Undo restores the exact mapping, including its tuned amount.
            inverseAction: {
                type: 'addMapping',
                payload: {
                    modulatorId: action.payload.modulatorId,
                    mapping: prev,
                },
            },
        };
    },
    undoable: true,
});
