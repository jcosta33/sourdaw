import { describe, it, expect } from 'vitest';

import { commandRegistry } from '#/modules/Command/models/CommandRegistry';

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

    it('exposes a command-palette entry that dispatches the clearAllMidiMappings action', () => {
        const entry = commandRegistry.find((command) => command.id === 'clear-all-midi-mappings');

        expect(entry).toBeDefined();
        // Declarative action form — the palette dispatches it straight through
        // executeAppAction, which resolves it to the handler registered above.
        expect(entry?.action).toEqual({ type: 'clearAllMidiMappings' });
    });
});
