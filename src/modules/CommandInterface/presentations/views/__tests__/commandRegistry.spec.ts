import { describe, it, expect } from 'vitest';

import { commandRegistry } from '../commandRegistry';

describe('commandRegistry', () => {
    it('should expose each command id once', () => {
        const command_counts_by_id = new Map<string, number>();

        for (const command_entry of commandRegistry) {
            const previous_count = command_counts_by_id.get(command_entry.id) ?? 0;
            command_counts_by_id.set(command_entry.id, previous_count + 1);
        }

        const duplicate_ids = Array.from(command_counts_by_id.entries())
            .filter(([, duplicate_count]) => duplicate_count > 1)
            .map(([command_id]) => command_id);

        expect(duplicate_ids).toEqual([]);
    });

    it('dispatches the clear-all MIDI mappings action', () => {
        const entry = commandRegistry.find((command) => command.id === 'clear-all-midi-mappings');

        expect(entry?.action).toEqual({ type: 'clearAllMidiMappings' });
    });
});
