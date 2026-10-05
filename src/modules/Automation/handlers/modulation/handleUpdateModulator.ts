import { createHandler } from '#/utils/createHandler';

import { modulationStore } from '../../stores/modulationStore';
import { type ModulatorPatch, updateModulator } from '../../useCases/modulation/updateModulator';

export const handleUpdateModulator = createHandler<'updateModulator'>({
    // `updateModulator` throws on an empty trackId rather than writing one; the
    // batch validator refuses before any effect instead.
    validate: (action) => action.payload.patch.trackId !== '',
    execute: (action) => {
        updateModulator(action.payload.modulatorId, action.payload.patch);
        return undefined;
    },
    describe: (action) => {
        const prev = modulationStore.value?.modulators.find((modulator) => modulator.id === action.payload.modulatorId);
        if (!prev) {
            return { label: 'Update modulator' };
        }
        // The inverse patches back only the keys the forward patch touched, so
        // it restores exactly the prior values without overwriting anything
        // else a concurrent edit may have changed.
        const inversePatch: ModulatorPatch = {};
        if (action.payload.patch.name !== undefined) {
            inversePatch.name = prev.name;
        }
        if (action.payload.patch.enabled !== undefined) {
            inversePatch.enabled = prev.enabled;
        }
        if (action.payload.patch.trackId !== undefined) {
            inversePatch.trackId = prev.trackId;
        }
        return {
            label: `Update modulator "${prev.name}" (${prev.id})`,
            inverseAction: { type: 'updateModulator', payload: { modulatorId: prev.id, patch: inversePatch } },
        };
    },
    undoable: true,
});
