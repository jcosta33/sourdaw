import { describe, it, expect } from 'vitest';

import { handleClearAllMappings } from '../../handlers/midiLearn/handleClearAllMappings';
import { getMidiLearnHandlers } from '../getMidiLearnHandlers';

describe('getMidiLearnHandlers — clearAllMidiMappings binding (inventory item #13)', () => {
    it('registers the clear-all-mappings handler under the clearAllMidiMappings action type', () => {
        const handlers = getMidiLearnHandlers();

        // This is what makes the use-case reachable in production: bootstrap merges
        // this map into the shared handler registry, and executeAppAction dispatches
        // `clearAllMidiMappings` to it. Without this key the use-case is dead code.
        expect(handlers.clearAllMidiMappings).toBe(handleClearAllMappings);
    });
});
