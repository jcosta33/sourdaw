import { createHandler } from '#/utils/createHandler';

import { setDeviceState } from '../../useCases/device/setDeviceState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSetDeviceState = createHandler<'setDeviceState'>({
    execute: (alpha) =>
        toHandlerExecutionResult(setDeviceState({ deviceId: alpha.payload.deviceId, state: alpha.payload.state })),
    // Not undoable, for the same reason as `setExternalPluginState`: this action
    // mirrors state a device already holds live rather than expressing a user edit.
    // Undoing it would rewind project truth while the device's own session store kept
    // the newer value, and the next mirror would simply write it back — an undo entry
    // that visibly does nothing.
    //
    // Device edits therefore still have no undo of their own; giving them one means
    // routing the edits themselves through actions, which is a larger change than
    // making them survive a reload and is deliberately not attempted here.
    describe: () => ({ label: 'Capture device state' }),
    undoable: false,
});
