import { handleAddTimeSignatureChange } from '../handlers/transport/handleAddTimeSignatureChange';
import { handleNextSetlistItem } from '../handlers/transport/handleNextSetlistItem';
import { handlePreviousSetlistItem } from '../handlers/transport/handlePreviousSetlistItem';
import { handleRemoveTimeSignatureChange } from '../handlers/transport/handleRemoveTimeSignatureChange';
import { handleRestorePunchRegion } from '../handlers/transport/handleRestorePunchRegion';
import { handleSeekPlayhead } from '../handlers/transport/handleSeekPlayhead';
import { handleSetCountInBars } from '../handlers/transport/handleSetCountInBars';
import { handleSetLoopRegion } from '../handlers/transport/handleSetLoopRegion';
import { handleSetMetronomeVolume } from '../handlers/transport/handleSetMetronomeVolume';
import { handleSetPreRollBars } from '../handlers/transport/handleSetPreRollBars';
import { handleSetPunchIn } from '../handlers/transport/handleSetPunchIn';
import { handleSetPunchOut } from '../handlers/transport/handleSetPunchOut';
import { handleSetTempo } from '../handlers/transport/handleSetTempo';
import { handleSetTimeSignature } from '../handlers/transport/handleSetTimeSignature';
import { handleStopPlayback } from '../handlers/transport/handleStopPlayback';
import { handleToggleCountIn } from '../handlers/transport/handleToggleCountIn';
import { handleToggleLoop } from '../handlers/transport/handleToggleLoop';
import { handleToggleLoopRecord } from '../handlers/transport/handleToggleLoopRecord';
import { handleToggleMetronome } from '../handlers/transport/handleToggleMetronome';
import { handleTogglePlayback } from '../handlers/transport/handleTogglePlayback';
import { handleTogglePreRoll } from '../handlers/transport/handleTogglePreRoll';
import { handleTogglePunch } from '../handlers/transport/handleTogglePunch';
import { handleTogglePunchRecording } from '../handlers/transport/handleTogglePunchRecording';
import { handleToggleRecording } from '../handlers/transport/handleToggleRecording';
import { handleTriggerScene } from '../handlers/transport/handleTriggerScene';

export type TransportHandlersMap = {
    addTimeSignatureChange: typeof handleAddTimeSignatureChange;
    nextSetlistItem: typeof handleNextSetlistItem;
    previousSetlistItem: typeof handlePreviousSetlistItem;
    removeTimeSignatureChange: typeof handleRemoveTimeSignatureChange;
    restorePunchRegion: typeof handleRestorePunchRegion;
    seekPlayhead: typeof handleSeekPlayhead;
    setCountInBars: typeof handleSetCountInBars;
    setLoopRegion: typeof handleSetLoopRegion;
    setMetronomeVolume: typeof handleSetMetronomeVolume;
    setPreRollBars: typeof handleSetPreRollBars;
    setPunchIn: typeof handleSetPunchIn;
    setPunchOut: typeof handleSetPunchOut;
    setTempo: typeof handleSetTempo;
    setTimeSignature: typeof handleSetTimeSignature;
    stopPlayback: typeof handleStopPlayback;
    toggleCountIn: typeof handleToggleCountIn;
    toggleLoop: typeof handleToggleLoop;
    toggleMetronome: typeof handleToggleMetronome;
    togglePlayback: typeof handleTogglePlayback;
    togglePreRoll: typeof handleTogglePreRoll;
    togglePunch: typeof handleTogglePunch;
    toggleLoopRecord: typeof handleToggleLoopRecord;
    togglePunchRecording: typeof handleTogglePunchRecording;
    toggleRecording: typeof handleToggleRecording;
    triggerScene: typeof handleTriggerScene;
};

/**
 * Merges Transport `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getTransportHandlers(): TransportHandlersMap {
    return {
        setTempo: handleSetTempo,
        togglePlayback: handleTogglePlayback,
        stopPlayback: handleStopPlayback,
        toggleRecording: handleToggleRecording,
        toggleLoop: handleToggleLoop,
        toggleMetronome: handleToggleMetronome,
        setMetronomeVolume: handleSetMetronomeVolume,
        setLoopRegion: handleSetLoopRegion,
        seekPlayhead: handleSeekPlayhead,
        setPunchIn: handleSetPunchIn,
        setPunchOut: handleSetPunchOut,
        togglePunch: handleTogglePunch,
        toggleCountIn: handleToggleCountIn,
        setCountInBars: handleSetCountInBars,
        setTimeSignature: handleSetTimeSignature,
        addTimeSignatureChange: handleAddTimeSignatureChange,
        removeTimeSignatureChange: handleRemoveTimeSignatureChange,
        restorePunchRegion: handleRestorePunchRegion,
        togglePreRoll: handleTogglePreRoll,
        setPreRollBars: handleSetPreRollBars,
        togglePunchRecording: handleTogglePunchRecording,
        toggleLoopRecord: handleToggleLoopRecord,
        triggerScene: handleTriggerScene,
        nextSetlistItem: handleNextSetlistItem,
        previousSetlistItem: handlePreviousSetlistItem,
    };
}
