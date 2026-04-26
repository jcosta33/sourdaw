import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleHumanizeNotes } from '../handleHumanizeNotes';

const mocks = vi.hoisted(() => ({
    humanizeNotes: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    humanizeNotes: mocks.humanizeNotes,
}));

describe('handleHumanizeNotes', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates to humanizeNotes MIDI use case', () => {
        void handleHumanizeNotes.execute({
            type: 'humanizeNotes',
            payload: { clipId: 'c1', amount: 0.1 },
        });
        expect(mocks.humanizeNotes).toHaveBeenCalledWith('c1', 0.1);
    });
});
