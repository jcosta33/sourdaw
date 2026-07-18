import { handleSwitchMonitor } from '../handlers/controlRoom/handleSwitchMonitor';
import { handleToggleControlRoomDim } from '../handlers/controlRoom/handleToggleControlRoomDim';
import { handleToggleControlRoomMono } from '../handlers/controlRoom/handleToggleControlRoomMono';

export type ControlRoomHandlersMap = {
    switchMonitor: typeof handleSwitchMonitor;
    toggleControlRoomDim: typeof handleToggleControlRoomDim;
    toggleControlRoomMono: typeof handleToggleControlRoomMono;
};

/**
 * Merges control-room `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getControlRoomHandlers(): ControlRoomHandlersMap {
    return {
        switchMonitor: handleSwitchMonitor,
        toggleControlRoomDim: handleToggleControlRoomDim,
        toggleControlRoomMono: handleToggleControlRoomMono,
    };
}
