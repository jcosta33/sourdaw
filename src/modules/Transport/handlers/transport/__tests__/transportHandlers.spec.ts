import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleTogglePlayback } from '../handleTogglePlayback';
import { handleStopPlayback } from '../handleStopPlayback';
import { handleSeekPlayhead } from '../handleSeekPlayhead';
import { handleToggleLoop } from '../handleToggleLoop';
import { handleSetLoopRegion } from '../handleSetLoopRegion';

const mocks = vi.hoisted(() => ({
    togglePlayback: vi.fn(),
    stopPlayback: vi.fn(),
    seekPlayhead: vi.fn(),
    toggleLoop: vi.fn(),
    setLoopRegion: vi.fn(),
}));

vi.mock('../../../useCases/transportControls/togglePlayback', () => ({ togglePlayback: mocks.togglePlayback }));
vi.mock('../../../useCases/transportControls/stopPlayback', () => ({ stopPlayback: mocks.stopPlayback }));
vi.mock('../../../useCases/transportControls/seekPlayhead', () => ({ seekPlayhead: mocks.seekPlayhead }));
vi.mock('../../../useCases/transportControls/toggleLoop', () => ({ toggleLoop: mocks.toggleLoop }));
vi.mock('../../../useCases/transportControls/setLoopRegion', () => ({ setLoopRegion: mocks.setLoopRegion }));

describe('Transport Handlers', () => {
    beforeEach(() => vi.clearAllMocks());

    it('handleTogglePlayback delegates to use case', () => {
        handleTogglePlayback.execute({ type: 'togglePlayback', payload: {} });
        expect(mocks.togglePlayback).toHaveBeenCalled();
    });

    it('handleStopPlayback delegates to use case', () => {
        handleStopPlayback.execute({ type: 'stopPlayback', payload: {} });
        expect(mocks.stopPlayback).toHaveBeenCalled();
    });

    it('handleSeekPlayhead delegates to use case', () => {
        handleSeekPlayhead.execute({ type: 'seekPlayhead', payload: { beat: 16 } });
        expect(mocks.seekPlayhead).toHaveBeenCalledWith(16);
    });

    it('handleToggleLoop delegates to use case', () => {
        handleToggleLoop.execute({ type: 'toggleLoop', payload: {} });
        expect(mocks.toggleLoop).toHaveBeenCalled();
    });

    it('handleSetLoopRegion delegates to use case', () => {
        handleSetLoopRegion.execute({ type: 'setLoopRegion', payload: { startBeat: 0, endBeat: 4 } });
        expect(mocks.setLoopRegion).toHaveBeenCalledWith(0, 4);
    });
});
