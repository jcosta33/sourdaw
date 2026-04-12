import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSetMidiOutput } from '../handleSetMidiOutput';

const mocks = vi.hoisted(() => ({
    setMidiOutput: vi.fn(),
}));

vi.mock('../../../useCases/midiRouting/setMidiOutput', () => ({
    setMidiOutput: mocks.setMidiOutput,
}));

describe('handleSetMidiOutput', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates to setMidiOutput use case', () => {
        handleSetMidiOutput.execute({
            type: 'setMidiOutput',
            payload: { trackId: 't1', destinationTrackId: 't2' }
        });
        expect(mocks.setMidiOutput).toHaveBeenCalledWith('t1', 't2');
    });
});
