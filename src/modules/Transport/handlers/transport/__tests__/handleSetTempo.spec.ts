import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setTempo } from '../../../useCases/setTempo';
import { stopPlayback } from '../../../useCases/transportControls/stopPlayback';
import { getTransportState } from '../../../useCases/transportQueries/getTransportState';
import { handleSetTempo } from '../handleSetTempo';
import { handleStopPlayback } from '../handleStopPlayback';

vi.mock('../../../useCases/setTempo', () => ({
    setTempo: vi.fn(),
}));

vi.mock('../../../useCases/transportQueries/getTransportState', () => ({
    getTransportState: vi.fn(() => ({ tempo: 110 })),
}));

vi.mock('../../../useCases/transportControls/stopPlayback', () => ({
    stopPlayback: vi.fn(),
}));

describe('transport handlers', () => {
    beforeEach(() => {
        vi.mocked(setTempo).mockClear();
        vi.mocked(stopPlayback).mockClear();
    });

    it('handleSetTempo forwards bpm to setTempo', () => {
        void handleSetTempo.execute({ type: 'setTempo', payload: { bpm: 120 } });

        expect(setTempo).toHaveBeenCalledWith(120);
    });

    it('handleSetTempo captures the previous tempo for atomic compensation', () => {
        expect(handleSetTempo.describe({ type: 'setTempo', payload: { bpm: 128 } })).toEqual({
            label: 'Set tempo to 128 BPM',
            inverseAction: { type: 'setTempo', payload: { bpm: 110 } },
        });
        expect(getTransportState).toHaveBeenCalledOnce();
    });

    it('handleStopPlayback calls stopPlayback', () => {
        void handleStopPlayback.execute({ type: 'stopPlayback', payload: undefined });

        expect(stopPlayback).toHaveBeenCalled();
    });
});
