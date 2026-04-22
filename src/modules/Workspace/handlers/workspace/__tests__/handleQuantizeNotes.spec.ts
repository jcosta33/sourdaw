import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleQuantizeNotes } from '../handleQuantizeNotes';

const mocks = vi.hoisted(() => ({
    quantizeNotes: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    quantizeNotes: mocks.quantizeNotes,
}));

describe('handleQuantizeNotes', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates to quantizeNotes MIDI use case', () => {
        void handleQuantizeNotes.execute({
            type: 'quantizeNotes',
            payload: { clipId: 'c1', gridSize: 0.25 },
        });
        expect(mocks.quantizeNotes).toHaveBeenCalledWith('c1', 0.25, undefined, undefined);
    });
});
