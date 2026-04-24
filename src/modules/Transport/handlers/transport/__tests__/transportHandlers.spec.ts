import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAddTimeSignatureChange } from '../handleAddTimeSignatureChange';
import { handleNextSetlistItem } from '../handleNextSetlistItem';
import { handlePreviousSetlistItem } from '../handlePreviousSetlistItem';
import { handleRemoveTimeSignatureChange } from '../handleRemoveTimeSignatureChange';
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
import { handleToggleLoopRecord } from '../handleToggleLoopRecord';
import { handleTogglePunchRecording } from '../handleTogglePunchRecording';
import { handleToggleRecording } from '../handleToggleRecording';
import { handleTriggerScene } from '../handleTriggerScene';

const mocks = vi.hoisted(() => ({
    nextItem: vi.fn(),
    notifyUser: vi.fn(),
    previousItem: vi.fn(),
    togglePunchRecording: vi.fn(),
    togglePlayback: vi.fn(),
    stopPlayback: vi.fn(),
    seekPlayhead: vi.fn(),
    toggleLoop: vi.fn(),
    setLoopRegion: vi.fn(),
    addTimeSignatureChange: vi.fn(),
    removeTimeSignatureChange: vi.fn(),
    setCountInBars: vi.fn(),
    setMetronomeVolume: vi.fn(),
    setPreRollBars: vi.fn(),
    setPunchIn: vi.fn(),
    setPunchOut: vi.fn(),
    toggleCountIn: vi.fn(),
    toggleMetronome: vi.fn(),
    togglePreRoll: vi.fn(),
    togglePunchEnabled: vi.fn(),
    toggleRecord: vi.fn(),
    toggleRecording: vi.fn(),
    triggerScene: vi.fn(),
}));

vi.mock('../../../useCases/setlist/nextItem', () => ({ nextItem: mocks.nextItem }));
vi.mock('../../../useCases/setlist/previousItem', () => ({ previousItem: mocks.previousItem }));
vi.mock('../../../useCases/punchRecording/togglePunchRecording', () => ({
    togglePunchRecording: mocks.togglePunchRecording,
}));
vi.mock('../../../useCases/loopStation/toggleRecord', () => ({ toggleRecord: mocks.toggleRecord }));
vi.mock('../../../useCases/loopStation/triggerScene', () => ({ triggerScene: mocks.triggerScene }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));
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

    it('handleAddTimeSignatureChange delegates to use case', () => {
        handleAddTimeSignatureChange.execute({
            type: 'addTimeSignatureChange',
            payload: { beat: 0, numerator: 3, denominator: 4 },
        });
        expect(mocks.addTimeSignatureChange).toHaveBeenCalledWith(0, 3, 4);
    });

    it('handleRemoveTimeSignatureChange delegates to use case', () => {
        handleRemoveTimeSignatureChange.execute({ type: 'removeTimeSignatureChange', payload: { beat: 4 } });
        expect(mocks.removeTimeSignatureChange).toHaveBeenCalledWith(4);
    });

    it('handleSetCountInBars delegates to use case', () => {
        handleSetCountInBars.execute({ type: 'setCountInBars', payload: { bars: 2 } });
        expect(mocks.setCountInBars).toHaveBeenCalledWith(2);
    });

    it('handleSetMetronomeVolume delegates to use case', () => {
        handleSetMetronomeVolume.execute({ type: 'setMetronomeVolume', payload: { volume: 0.5 } });
        expect(mocks.setMetronomeVolume).toHaveBeenCalledWith(0.5);
    });

    it('handleSetPreRollBars delegates to use case', () => {
        handleSetPreRollBars.execute({ type: 'setPreRollBars', payload: { bars: 1 } });
        expect(mocks.setPreRollBars).toHaveBeenCalledWith(1);
    });

    it('handleSetPunchIn delegates to use case', () => {
        handleSetPunchIn.execute({ type: 'setPunchIn', payload: { beat: 8 } });
        expect(mocks.setPunchIn).toHaveBeenCalledWith(8);
    });

    it('handleSetPunchOut delegates to use case', () => {
        handleSetPunchOut.execute({ type: 'setPunchOut', payload: { beat: 16 } });
        expect(mocks.setPunchOut).toHaveBeenCalledWith(16);
    });

    it('handleToggleCountIn delegates to use case', () => {
        handleToggleCountIn.execute({ type: 'toggleCountIn', payload: {} });
        expect(mocks.toggleCountIn).toHaveBeenCalled();
    });

    it('handleToggleMetronome delegates to use case', () => {
        handleToggleMetronome.execute({ type: 'toggleMetronome', payload: {} });
        expect(mocks.toggleMetronome).toHaveBeenCalled();
    });

    it('handleTogglePreRoll delegates to use case', () => {
        handleTogglePreRoll.execute({ type: 'togglePreRoll', payload: {} });
        expect(mocks.togglePreRoll).toHaveBeenCalled();
    });

    it('handleTogglePunch delegates to use case', () => {
        handleTogglePunch.execute({ type: 'togglePunch', payload: {} });
        expect(mocks.togglePunchEnabled).toHaveBeenCalled();
    });

    it('handleToggleRecording delegates to use case', () => {
        handleToggleRecording.execute({ type: 'toggleRecording', payload: {} });
        expect(mocks.toggleRecording).toHaveBeenCalled();
    });

    it('handleTogglePunchRecording delegates to use case and notifies the user', () => {
        handleTogglePunchRecording.execute({ type: 'togglePunchRecording', payload: {} });
        expect(mocks.togglePunchRecording).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith('Punch recording toggled');
    });

    it('handleToggleLoopRecord delegates to use case with slot id', () => {
        handleToggleLoopRecord.execute({ type: 'toggleLoopRecord', payload: { slotId: 'slot-1' } });
        expect(mocks.toggleRecord).toHaveBeenCalledWith('slot-1');
    });

    it('handleTriggerScene delegates to use case with column', () => {
        handleTriggerScene.execute({ type: 'triggerScene', payload: { column: 2 } });
        expect(mocks.triggerScene).toHaveBeenCalledWith(2);
    });

    it('handleNextSetlistItem delegates to use case', () => {
        handleNextSetlistItem.execute({ type: 'nextSetlistItem', payload: {} });
        expect(mocks.nextItem).toHaveBeenCalledTimes(1);
    });

    it('handlePreviousSetlistItem delegates to use case', () => {
        handlePreviousSetlistItem.execute({ type: 'previousSetlistItem', payload: {} });
        expect(mocks.previousItem).toHaveBeenCalledTimes(1);
    });
});
