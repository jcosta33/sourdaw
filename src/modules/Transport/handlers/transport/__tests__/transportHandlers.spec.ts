import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAddTimeSignatureChange } from '../handleAddTimeSignatureChange';
import { handleRemoveTimeSignatureChange } from '../handleRemoveTimeSignatureChange';
import { handleRestorePunchRegion } from '../handleRestorePunchRegion';
import { handleSeekPlayhead } from '../handleSeekPlayhead';
import { handleSetCountInBars } from '../handleSetCountInBars';
import { handleSetLoopRegion } from '../handleSetLoopRegion';
import { handleSetMetronomeVolume } from '../handleSetMetronomeVolume';
import { handleSetPreRollBars } from '../handleSetPreRollBars';
import { handleSetPunchIn } from '../handleSetPunchIn';
import { handleSetPunchOut } from '../handleSetPunchOut';
import { handleStopPlayback } from '../handleStopPlayback';
import { handleToggleCountIn } from '../handleToggleCountIn';
import { handleToggleLoop } from '../handleToggleLoop';
import { handleToggleMetronome } from '../handleToggleMetronome';
import { handleTogglePlayback } from '../handleTogglePlayback';
import { handleTogglePreRoll } from '../handleTogglePreRoll';
import { handleTogglePunch } from '../handleTogglePunch';
import { handleToggleRecording } from '../handleToggleRecording';

const mocks = vi.hoisted(() => ({
    togglePlayback: vi.fn(),
    stopPlayback: vi.fn(),
    seekPlayhead: vi.fn(),
    toggleLoop: vi.fn(),
    setLoopRegion: vi.fn(),
    addTimeSignatureChange: vi.fn(),
    removeTimeSignatureChange: vi.fn(),
    restorePunchRegion: vi.fn(),
    setCountInBars: vi.fn(),
    setMetronomeVolume: vi.fn(),
    setPreRollBars: vi.fn(),
    setPunchIn: vi.fn(),
    setPunchOut: vi.fn(),
    toggleCountIn: vi.fn(),
    toggleMetronome: vi.fn(),
    togglePreRoll: vi.fn(),
    togglePunchEnabled: vi.fn(),
    toggleRecording: vi.fn(),
}));

vi.mock('../../../useCases/transportControls/togglePlayback', () => ({ togglePlayback: mocks.togglePlayback }));
vi.mock('../../../useCases/transportControls/stopPlayback', () => ({ stopPlayback: mocks.stopPlayback }));
vi.mock('../../../useCases/transportControls/seekPlayhead', () => ({ seekPlayhead: mocks.seekPlayhead }));
vi.mock('../../../useCases/transportControls/toggleLoop', () => ({ toggleLoop: mocks.toggleLoop }));
vi.mock('../../../useCases/transportControls/setLoopRegion', () => ({ setLoopRegion: mocks.setLoopRegion }));
vi.mock('../../../useCases/timeSignatureChanges/addTimeSignatureChange', () => ({
    addTimeSignatureChange: mocks.addTimeSignatureChange,
}));
vi.mock('../../../useCases/timeSignatureChanges/removeTimeSignatureChange', () => ({
    removeTimeSignatureChange: mocks.removeTimeSignatureChange,
}));
vi.mock('../../../useCases/transportControls/restorePunchRegion', () => ({
    restorePunchRegion: mocks.restorePunchRegion,
}));
vi.mock('../../../useCases/transportControls/setCountInBars', () => ({ setCountInBars: mocks.setCountInBars }));
vi.mock('../../../useCases/transportControls/setMetronomeVolume', () => ({
    setMetronomeVolume: mocks.setMetronomeVolume,
}));
vi.mock('../../../useCases/transportControls/setPreRollBars', () => ({ setPreRollBars: mocks.setPreRollBars }));
vi.mock('../../../useCases/transportControls/setPunchIn', () => ({ setPunchIn: mocks.setPunchIn }));
vi.mock('../../../useCases/transportControls/setPunchOut', () => ({ setPunchOut: mocks.setPunchOut }));
vi.mock('../../../useCases/transportControls/toggleCountIn', () => ({ toggleCountIn: mocks.toggleCountIn }));
vi.mock('../../../useCases/transportControls/toggleMetronome', () => ({ toggleMetronome: mocks.toggleMetronome }));
vi.mock('../../../useCases/transportControls/togglePreRoll', () => ({ togglePreRoll: mocks.togglePreRoll }));
vi.mock('../../../useCases/transportControls/togglePunchEnabled', () => ({
    togglePunchEnabled: mocks.togglePunchEnabled,
}));
vi.mock('../../../useCases/transportControls/toggleRecording', () => ({ toggleRecording: mocks.toggleRecording }));

describe('Transport Handlers', () => {
    beforeEach(() => vi.clearAllMocks());

    it('handleTogglePlayback delegates to use case', () => {
        void handleTogglePlayback.execute({ type: 'togglePlayback', payload: undefined });
        expect(mocks.togglePlayback).toHaveBeenCalled();
    });

    it('handleStopPlayback delegates to use case and returns its completion', async () => {
        const completion = Promise.resolve();
        mocks.stopPlayback.mockReturnValueOnce(completion);

        const execution = handleStopPlayback.execute({ type: 'stopPlayback', payload: undefined });

        expect(execution).toBe(completion);
        await execution;
        expect(mocks.stopPlayback).toHaveBeenCalled();
    });

    it('handleSeekPlayhead delegates to use case', () => {
        void handleSeekPlayhead.execute({ type: 'seekPlayhead', payload: { beat: 16 } });
        expect(mocks.seekPlayhead).toHaveBeenCalledWith(16);
    });

    it('handleToggleLoop delegates to use case', () => {
        void handleToggleLoop.execute({ type: 'toggleLoop', payload: undefined });
        expect(mocks.toggleLoop).toHaveBeenCalled();
    });

    it('handleSetLoopRegion delegates to use case', () => {
        void handleSetLoopRegion.execute({ type: 'setLoopRegion', payload: { startBeat: 0, endBeat: 4 } });
        expect(mocks.setLoopRegion).toHaveBeenCalledWith(0, 4, false);
    });

    it('handleAddTimeSignatureChange delegates to use case', () => {
        void handleAddTimeSignatureChange.execute({
            type: 'addTimeSignatureChange',
            payload: { beat: 0, numerator: 3, denominator: 4 },
        });
        expect(mocks.addTimeSignatureChange).toHaveBeenCalledWith(0, 3, 4);
    });

    it('handleRemoveTimeSignatureChange delegates to use case', () => {
        void handleRemoveTimeSignatureChange.execute({ type: 'removeTimeSignatureChange', payload: { beat: 4 } });
        expect(mocks.removeTimeSignatureChange).toHaveBeenCalledWith(4);
    });

    it('handleSetCountInBars delegates to use case', () => {
        void handleSetCountInBars.execute({ type: 'setCountInBars', payload: { bars: 2 } });
        expect(mocks.setCountInBars).toHaveBeenCalledWith(2);
    });

    it('handleSetMetronomeVolume delegates to use case', () => {
        void handleSetMetronomeVolume.execute({ type: 'setMetronomeVolume', payload: { volume: 0.5 } });
        expect(mocks.setMetronomeVolume).toHaveBeenCalledWith(0.5);
    });

    it('handleSetPreRollBars delegates to use case', () => {
        void handleSetPreRollBars.execute({ type: 'setPreRollBars', payload: { bars: 1 } });
        expect(mocks.setPreRollBars).toHaveBeenCalledWith(1);
    });

    it('handleSetPunchIn delegates to use case', () => {
        void handleSetPunchIn.execute({ type: 'setPunchIn', payload: { beat: 8 } });
        expect(mocks.setPunchIn).toHaveBeenCalledWith(8);
    });

    it('handleSetPunchOut delegates to use case', () => {
        void handleSetPunchOut.execute({ type: 'setPunchOut', payload: { beat: 16 } });
        expect(mocks.setPunchOut).toHaveBeenCalledWith(16);
    });

    it('handleRestorePunchRegion delegates the complete pair to the atomic use case', () => {
        const region = { punchInBeat: 4, punchOutBeat: 12 };

        void handleRestorePunchRegion.execute({ type: 'restorePunchRegion', payload: region });

        expect(mocks.restorePunchRegion).toHaveBeenCalledWith(region);
    });

    it('handleToggleCountIn delegates to use case', () => {
        void handleToggleCountIn.execute({ type: 'toggleCountIn', payload: undefined });
        expect(mocks.toggleCountIn).toHaveBeenCalled();
    });

    it('handleToggleMetronome delegates to use case', () => {
        void handleToggleMetronome.execute({ type: 'toggleMetronome', payload: undefined });
        expect(mocks.toggleMetronome).toHaveBeenCalled();
    });

    it('handleTogglePreRoll delegates to use case', () => {
        void handleTogglePreRoll.execute({ type: 'togglePreRoll', payload: undefined });
        expect(mocks.togglePreRoll).toHaveBeenCalled();
    });

    it('handleTogglePunch delegates to use case', () => {
        void handleTogglePunch.execute({ type: 'togglePunch', payload: undefined });
        expect(mocks.togglePunchEnabled).toHaveBeenCalled();
    });

    it('handleToggleRecording delegates to use case', () => {
        void handleToggleRecording.execute({ type: 'toggleRecording', payload: undefined });
        expect(mocks.toggleRecording).toHaveBeenCalled();
    });
});
