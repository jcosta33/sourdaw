import { handleAddTimeSignatureChange } from '../handlers/transport/handleAddTimeSignatureChange';
import { handleRemoveTimeSignatureChange } from '../handlers/transport/handleRemoveTimeSignatureChange';
import { handleRestoreLoopRegion } from '../handlers/transport/handleRestoreLoopRegion';
import { handleRestoreMasterGain } from '../handlers/transport/handleRestoreMasterGain';
import { handleRestorePunchRegion } from '../handlers/transport/handleRestorePunchRegion';
import { handleSeekPlayhead } from '../handlers/transport/handleSeekPlayhead';
import { handleSetCountInBars } from '../handlers/transport/handleSetCountInBars';
import { handleSetLoopEnabled } from '../handlers/transport/handleSetLoopEnabled';
import { handleSetLoopRegion } from '../handlers/transport/handleSetLoopRegion';
import { handleSetMasterGain } from '../handlers/transport/handleSetMasterGain';
import { handleSetMetronomeEnabled } from '../handlers/transport/handleSetMetronomeEnabled';
import { handleSetMetronomeVolume } from '../handlers/transport/handleSetMetronomeVolume';
import { handleSetPlayback } from '../handlers/transport/handleSetPlayback';
import { handleSetPreRollBars } from '../handlers/transport/handleSetPreRollBars';
import { handleSetPunchIn } from '../handlers/transport/handleSetPunchIn';
import { handleSetPunchOut } from '../handlers/transport/handleSetPunchOut';
import { handleSetTempo } from '../handlers/transport/handleSetTempo';
import { handleSetTimeSignature } from '../handlers/transport/handleSetTimeSignature';
import { handleStopPlayback } from '../handlers/transport/handleStopPlayback';
import { handleToggleCountIn } from '../handlers/transport/handleToggleCountIn';
import { handleToggleLoop } from '../handlers/transport/handleToggleLoop';
import { handleToggleMetronome } from '../handlers/transport/handleToggleMetronome';
import { handleTogglePlayback } from '../handlers/transport/handleTogglePlayback';
import { handleTogglePreRoll } from '../handlers/transport/handleTogglePreRoll';
import { handleTogglePunch } from '../handlers/transport/handleTogglePunch';
import { handleToggleRecording } from '../handlers/transport/handleToggleRecording';

export type TransportHandlersMap = {
    addTimeSignatureChange: typeof handleAddTimeSignatureChange;
    removeTimeSignatureChange: typeof handleRemoveTimeSignatureChange;
    restorePunchRegion: typeof handleRestorePunchRegion;
    restoreLoopRegion: typeof handleRestoreLoopRegion;
    restoreMasterGain: typeof handleRestoreMasterGain;
    seekPlayhead: typeof handleSeekPlayhead;
    setCountInBars: typeof handleSetCountInBars;
    setLoopEnabled: typeof handleSetLoopEnabled;
    setLoopRegion: typeof handleSetLoopRegion;
    setMasterGain: typeof handleSetMasterGain;
    setMetronomeVolume: typeof handleSetMetronomeVolume;
    setPlayback: typeof handleSetPlayback;
    setMetronomeEnabled: typeof handleSetMetronomeEnabled;
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
    toggleRecording: typeof handleToggleRecording;
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
        setLoopEnabled: handleSetLoopEnabled,
        setMetronomeEnabled: handleSetMetronomeEnabled,
        restoreLoopRegion: handleRestoreLoopRegion,
        restoreMasterGain: handleRestoreMasterGain,
        setMasterGain: handleSetMasterGain,
        setMetronomeVolume: handleSetMetronomeVolume,
        setPlayback: handleSetPlayback,
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
    };
}
