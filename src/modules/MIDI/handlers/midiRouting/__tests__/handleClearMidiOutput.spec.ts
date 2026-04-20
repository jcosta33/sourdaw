import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleClearMidiOutput } from '../handleClearMidiOutput';

const mocks = vi.hoisted(() => ({
    clearMidiOutput: vi.fn(),
}));

vi.mock('../../../useCases/midiRouting/clearMidiOutput', () => ({
    clearMidiOutput: mocks.clearMidiOutput,
}));

describe('handleClearMidiOutput', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates to clearMidiOutput use case', () => {
        handleClearMidiOutput.execute({
            type: 'clearMidiOutput',
            payload: { trackId: 't1' },
        });
        expect(mocks.clearMidiOutput).toHaveBeenCalledWith('t1');
    });
});
