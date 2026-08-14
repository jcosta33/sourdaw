import { describe, it, expect } from 'vitest';

import { handleSetControlSurface } from '../../handlers/controlSurface/handleSetControlSurface';
import { handleClearAllMappings } from '../../handlers/midiLearn/handleClearAllMappings';
import {
    handleCompleteMidiLearn,
    handleRemoveMidiMapping,
    handleRestoreMidiLearnMappings,
} from '../../handlers/midiLearn/handleRestoreMidiLearnMappings';
import { handleConnectPush } from '../../handlers/push/handleConnectPush';
import { handleDisconnectPush } from '../../handlers/push/handleDisconnectPush';
import { getControlSurfaceHandlers } from '../getControlSurfaceHandlers';

describe('getControlSurfaceHandlers', () => {
    it('binds every ControlSurface action to its handler under the matching action type', () => {
        // These bindings are what make the use-cases reachable in production:
        // bootstrap merges this map into the shared handler registry and
        // executeAppAction dispatches by action type. Missing a key = dead code.
        const handlers = getControlSurfaceHandlers();

        expect(handlers.clearAllMidiMappings).toBe(handleClearAllMappings);
        expect(handlers.completeMidiLearn).toBe(handleCompleteMidiLearn);
        expect(handlers.connectPush).toBe(handleConnectPush);
        expect(handlers.disconnectPush).toBe(handleDisconnectPush);
        expect(handlers.removeMidiMapping).toBe(handleRemoveMidiMapping);
        expect(handlers.restoreMidiLearnMappings).toBe(handleRestoreMidiLearnMappings);
        expect(handlers.setControlSurface).toBe(handleSetControlSurface);
    });
});
