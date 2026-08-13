import { createHandler } from '#/utils/createHandler';

import { clearAllMappings } from '../../useCases/midiLearn/clearAllMappings';

/**
 * MIDI panic / recovery: drop every MIDI Learn mapping and cancel any in-progress
 * learn in one shot.
 *
 * `undoable: false` — deliberately, even though the mapping table is now
 * CRDT-backed project truth like every other MIDI Learn mutation (audit A-1).
 * This is the panic/recovery path: a user who reaches for it *because* a
 * controller is misbehaving must not have it silently reversible by a stray
 * Ctrl-Z, which would re-arm the very mappings they just escaped.
 */
export const handleClearAllMappings = createHandler<'clearAllMidiMappings'>({
    execute: () => {
        clearAllMappings();
    },
    describe: () => ({ label: 'Clear all MIDI mappings' }),
    undoable: false,
});
