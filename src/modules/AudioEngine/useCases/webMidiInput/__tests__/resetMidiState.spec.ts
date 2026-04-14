import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetMidiState as repoReset } from '../../../repositories/webMidi/lifecycle/resetMidiState';
import { resetMidiState } from '../resetMidiState';

vi.mock('../../../repositories/webMidi/lifecycle/resetMidiState', () => ({
    resetMidiState: vi.fn(),
}));

describe('resetMidiState', () => {
    beforeEach(() => {
        vi.mocked(repoReset).mockClear();
    });

    it('should delegate to the Web MIDI lifecycle repository', () => {
        resetMidiState();

        expect(repoReset).toHaveBeenCalledTimes(1);
    });
});
