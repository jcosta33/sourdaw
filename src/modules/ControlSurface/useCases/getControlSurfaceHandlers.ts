import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { handleSetControlSurface } from '../handlers/controlSurface/handleSetControlSurface';
import { handleClearAllMappings } from '../handlers/midiLearn/handleClearAllMappings';
import { handleConnectPush } from '../handlers/push/handleConnectPush';
import { handleDisconnectPush } from '../handlers/push/handleDisconnectPush';

type ControlSurfaceAppAction = Extract<
    AppAction,
    { type: 'clearAllMidiMappings' | 'connectPush' | 'disconnectPush' | 'setControlSurface' }
>;

export type ControlSurfaceHandlersMap = {
    [Action in ControlSurfaceAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges the ControlSurface `ActionHandler` maps for Command: MIDI-learn panic
 * clear, Ableton Push connect/disconnect, and MCU/OSC/HUI protocol select. Does
 * **not** call `createHandler` here.
 */
export function getControlSurfaceHandlers(): ControlSurfaceHandlersMap {
    return {
        clearAllMidiMappings: handleClearAllMappings,
        connectPush: handleConnectPush,
        disconnectPush: handleDisconnectPush,
        setControlSurface: handleSetControlSurface,
    };
}
