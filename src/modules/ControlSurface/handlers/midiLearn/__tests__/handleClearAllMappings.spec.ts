import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleClearAllMappings } from '../handleClearAllMappings';

const mocks = vi.hoisted(() => ({
    clearAllMappings: vi.fn<typeof import('../../../useCases/midiLearn/clearAllMappings').clearAllMappings>(),
}));

vi.mock('../../../useCases/midiLearn/clearAllMappings', () => ({
    clearAllMappings: mocks.clearAllMappings,
}));

describe('handleClearAllMappings', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates to the clearAllMappings use-case', () => {
        void handleClearAllMappings.execute({ type: 'clearAllMidiMappings' });

        expect(mocks.clearAllMappings).toHaveBeenCalledTimes(1);
    });

    it('is not undoable — a panic-recovery clear must not be reversible by a stray undo', () => {
        expect(handleClearAllMappings.undoable).toBe(false);
    });

    it('describes itself for the action log', () => {
        expect(handleClearAllMappings.describe({ type: 'clearAllMidiMappings' })).toEqual({
            label: 'Clear all MIDI mappings',
        });
    });
});
