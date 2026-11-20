import { createHandler } from '#/utils/createHandler';

import { modulationStore } from '../../stores/modulationStore';
import { addMapping } from '../../useCases/modulation/addMapping';
import { type MappingTarget } from '../../useCases/modulation/removeMapping';

function getMappingTarget(modulatorId: string, target: MappingTarget) {
    const modulator = modulationStore.value?.modulators.find((source) => source.id === modulatorId);
    const isNoop =
        !modulator ||
        modulator.mappings.some(
            (mapping) =>
                mapping.targetTrackId === target.targetTrackId &&
                mapping.targetDeviceId === target.targetDeviceId &&
                mapping.targetParamId === target.targetParamId
        );
    return { modulator, isNoop };
}

export const handleAddMapping = createHandler<'addMapping'>({
    isNoop: ({ payload }) => getMappingTarget(payload.modulatorId, payload.mapping).isNoop,
    execute: (action) => {
        addMapping(action.payload.modulatorId, action.payload.mapping);
        return undefined;
    },
    describe: (action) => {
        const { modulator, isNoop } = getMappingTarget(action.payload.modulatorId, action.payload.mapping);
        const label = modulator
            ? `Map ${modulator.name} (${modulator.id}) to ${action.payload.mapping.targetTrackId}/${action.payload.mapping.targetDeviceId}/${action.payload.mapping.targetParamId}`
            : 'Add modulation mapping';
        if (isNoop) {
            return { label, inverseAction: null };
        }
        return {
            label,
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
