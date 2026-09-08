import { createHandler } from '#/utils/createHandler';

import { setExternalPluginState } from '../../useCases/device/setExternalPluginState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSetExternalPluginState = createHandler<'setExternalPluginState'>({
    execute: (alpha) => {
        const result = setExternalPluginState(alpha.payload);
        if (!result.didWrite) {
            return toHandlerExecutionResult(false);
        }
        if (!result.pushReplacementToHost) {
            return toHandlerExecutionResult(true);
        }
        // A rejected restore left the host on its defaults, so the replacement
        // must be pushed to it before the capture that follows this action
        // reads the host. executeAppAction awaits this hook before it resolves.
        const push = result.pushReplacementToHost;
        return {
            status: 'written' as const,
            afterCommit: push,
            afterAmbiguousCommit: push,
        };
    },
    // Capturing plugin state at save time is not a user edit: it must reach
    // project truth (CRDT, persistence, collaboration) but carries no undo entry.
    describe: () => ({ label: 'Capture plugin state' }),
    undoable: false,
});
