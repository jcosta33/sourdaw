import { createHandler } from '#/utils/createHandler';

import { clearAllMappings } from '../../useCases/midiLearn/clearAllMappings';

/**
 * MIDI panic / recovery: drop every MIDI Learn mapping and cancel any in-progress
 * learn in one shot.
 *
 * `undoable: false` — the mapping table lives in the non-CRDT `midiLearnStore`
 * (session/config state, not the project document), so it is outside the undo
 * model entirely. A recovery action that the user reaches *because* a controller
 * is misbehaving must not be silently reversible by a stray Ctrl-Z, which would
 * re-arm the very mappings they just escaped.
 */
export const handleClearAllMappings = createHandler<'clearAllMidiMappings'>({
    execute: () => {
        clearAllMappings();
    },
    describe: () => ({ label: 'Clear all MIDI mappings' }),
    undoable: false,
});
