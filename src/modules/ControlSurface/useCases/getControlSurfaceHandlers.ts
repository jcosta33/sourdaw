import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { handleSetControlSurface } from '../handlers/controlSurface/handleSetControlSurface';
import { handleClearAllMappings } from '../handlers/midiLearn/handleClearAllMappings';
import {
    handleCompleteMidiLearn,
    handleRemoveMidiMapping,
    handleRestoreMidiLearnMappings,
} from '../handlers/midiLearn/handleRestoreMidiLearnMappings';
import { handleConnectPush } from '../handlers/push/handleConnectPush';
import { handleDisconnectPush } from '../handlers/push/handleDisconnectPush';

type ControlSurfaceAppAction = Extract<
    AppAction,
    {
        type:
            | 'clearAllMidiMappings'
            | 'completeMidiLearn'
            | 'connectPush'
            | 'disconnectPush'
            | 'removeMidiMapping'
            | 'restoreMidiLearnMappings'
            | 'setControlSurface';
    }
>;

export type ControlSurfaceHandlersMap = {
    [Action in ControlSurfaceAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges the ControlSurface `ActionHandler` maps for Command: MIDI-learn
 * learn/remove/restore/panic-clear (audit A-1 — routed through
 * `executeAppAction` like every other track/device binding, since a mapping
 * is project-scoped truth), Ableton Push connect/disconnect, and MCU/OSC/HUI
 * protocol select. Does **not** call `createHandler` here.
 */
export function getControlSurfaceHandlers(): ControlSurfaceHandlersMap {
    return {
        clearAllMidiMappings: handleClearAllMappings,
        completeMidiLearn: handleCompleteMidiLearn,
        connectPush: handleConnectPush,
        disconnectPush: handleDisconnectPush,
        removeMidiMapping: handleRemoveMidiMapping,
        restoreMidiLearnMappings: handleRestoreMidiLearnMappings,
        setControlSurface: handleSetControlSurface,
    };
}
