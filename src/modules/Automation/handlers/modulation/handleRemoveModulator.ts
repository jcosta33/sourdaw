import { createHandler } from '#/utils/createHandler';

import { modulationStore } from '../../stores/modulationStore';
import { removeModulator } from '../../useCases/modulation/removeModulator';

export const handleRemoveModulator = createHandler<'removeModulator'>({
    execute: (action) => {
        removeModulator(action.payload.modulatorId);
        return undefined;
    },
    describe: (action) => {
        const prev = modulationStore.value?.modulators.find((modulator) => modulator.id === action.payload.modulatorId);
        if (!prev) {
            return { label: 'Remove modulator' };
        }
        return {
            label: `Remove ${prev.kind} modulator "${prev.name}" (${prev.id})`,
            // Undo restores the exact modulator — same id, name, track scope,
            // kind config, mappings, and enabled flag.
            inverseAction: {
                type: 'addModulator',
                payload: {
                    modulator: {
                        name: prev.name,
                        trackId: prev.trackId,
                        kind: prev.kind,
                        config: prev.config,
                        mappings: Array.from(prev.mappings),
                        enabled: prev.enabled,
                    },
                    modulatorId: prev.id,
                },
            },
        };
    },
    undoable: true,
});
