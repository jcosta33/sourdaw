import { createHandler } from '#/utils/createHandler';

import { setExternalPluginState } from '../../useCases/device/setExternalPluginState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSetExternalPluginState = createHandler<'setExternalPluginState'>({
    execute: (alpha) =>
        toHandlerExecutionResult(setExternalPluginState(alpha.payload.deviceId, alpha.payload.stateChunk)),
    // Capturing plugin state at save time is not a user edit: it must reach
    // project truth (CRDT, persistence, collaboration) but carries no undo entry.
    describe: () => ({ label: 'Capture plugin state' }),
    undoable: false,
});
