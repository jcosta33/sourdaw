import { createHandler } from '#/utils/createHandler';

import { exportMidiClip } from '../../useCases/exportMidiClip';

export const handleExportMidi = createHandler<'exportMidi'>({
    execute: (action) => {
        exportMidiClip(action.payload.clipId);
    },
    describe: () => ({ label: 'Export MIDI' }),
    undoable: false,
});
