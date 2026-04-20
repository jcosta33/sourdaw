import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetTempo } from '../handleSetTempo';
import { handleStopPlayback } from '../handleStopPlayback';

vi.mock('../../../useCases/setTempo', () => ({
    setTempo: vi.fn(),
}));

vi.mock('../../../useCases/transportControls/stopPlayback', () => ({
    stopPlayback: vi.fn(),
}));

import { setTempo } from '../../../useCases/setTempo';
import { stopPlayback } from '../../../useCases/transportControls/stopPlayback';

describe('transport handlers', () => {
    beforeEach(() => {
        vi.mocked(setTempo).mockClear();
        vi.mocked(stopPlayback).mockClear();
    });

    it('handleSetTempo forwards bpm to setTempo', () => {
        handleSetTempo.execute({ type: 'setTempo', payload: { bpm: 120 } });

        expect(setTempo).toHaveBeenCalledWith(120);
    });

    it('handleStopPlayback calls stopPlayback', () => {
        handleStopPlayback.execute({ type: 'stopPlayback', payload: undefined });

        expect(stopPlayback).toHaveBeenCalled();
    });
});
