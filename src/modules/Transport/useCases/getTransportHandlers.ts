import { type ActionHandler, type AppAction } from '#/modules/Command/useCases';

import { handleAddTimeSignatureChange } from '../handlers/transport/handleAddTimeSignatureChange';
import { handleRemoveTimeSignatureChange } from '../handlers/transport/handleRemoveTimeSignatureChange';
import { handleSeekPlayhead } from '../handlers/transport/handleSeekPlayhead';
import { handleSetCountInBars } from '../handlers/transport/handleSetCountInBars';
import { handleSetLoopRegion } from '../handlers/transport/handleSetLoopRegion';
import { handleSetMasterGain } from '../handlers/transport/handleSetMasterGain';
import { handleSetMetronomeVolume } from '../handlers/transport/handleSetMetronomeVolume';
import { handleSetPreRollBars } from '../handlers/transport/handleSetPreRollBars';
import { handleSetPunchIn } from '../handlers/transport/handleSetPunchIn';
import { handleSetPunchOut } from '../handlers/transport/handleSetPunchOut';
import { handleSetTempo } from '../handlers/transport/handleSetTempo';
import { handleStopPlayback } from '../handlers/transport/handleStopPlayback';
import { handleToggleCountIn } from '../handlers/transport/handleToggleCountIn';
import { handleToggleLoop } from '../handlers/transport/handleToggleLoop';
import { handleToggleMetronome } from '../handlers/transport/handleToggleMetronome';
import { handleTogglePlayback } from '../handlers/transport/handleTogglePlayback';
import { handleTogglePreRoll } from '../handlers/transport/handleTogglePreRoll';
import { handleTogglePunch } from '../handlers/transport/handleTogglePunch';
import { handleToggleRecording } from '../handlers/transport/handleToggleRecording';

type TransportAppAction =
    | Extract<AppAction, { type: 'setTempo' }>
    | Extract<AppAction, { type: 'togglePlayback' }>
    | Extract<AppAction, { type: 'stopPlayback' }>
    | Extract<AppAction, { type: 'toggleRecording' }>
    | Extract<AppAction, { type: 'toggleLoop' }>
    | Extract<AppAction, { type: 'toggleMetronome' }>
    | Extract<AppAction, { type: 'setMetronomeVolume' }>
    | Extract<AppAction, { type: 'setMasterGain' }>
    | Extract<AppAction, { type: 'setLoopRegion' }>
    | Extract<AppAction, { type: 'seekPlayhead' }>
    | Extract<AppAction, { type: 'setPunchIn' }>
    | Extract<AppAction, { type: 'setPunchOut' }>
    | Extract<AppAction, { type: 'togglePunch' }>
    | Extract<AppAction, { type: 'toggleCountIn' }>
    | Extract<AppAction, { type: 'setCountInBars' }>
    | Extract<AppAction, { type: 'addTimeSignatureChange' }>
    | Extract<AppAction, { type: 'removeTimeSignatureChange' }>
    | Extract<AppAction, { type: 'togglePreRoll' }>
    | Extract<AppAction, { type: 'setPreRollBars' }>;

export type TransportHandlersMap = {
    [Action in TransportAppAction as Action['type']]: ActionHandler<Action>;
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
        setMasterGain: handleSetMasterGain,
        setLoopRegion: handleSetLoopRegion,
        seekPlayhead: handleSeekPlayhead,
        setPunchIn: handleSetPunchIn,
        setPunchOut: handleSetPunchOut,
        togglePunch: handleTogglePunch,
        toggleCountIn: handleToggleCountIn,
        setCountInBars: handleSetCountInBars,
        addTimeSignatureChange: handleAddTimeSignatureChange,
        removeTimeSignatureChange: handleRemoveTimeSignatureChange,
        togglePreRoll: handleTogglePreRoll,
        setPreRollBars: handleSetPreRollBars,
    };
}
