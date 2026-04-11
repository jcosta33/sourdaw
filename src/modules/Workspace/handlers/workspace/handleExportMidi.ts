import { createHandler } from '#/helpers/createHandler';
import { exportMidiClip } from '#/modules/Arrangement/useCases';

export const handleExportMidi = createHandler<'exportMidi'>({
    execute: (a) => {
        exportMidiClip(a.payload.clipId);
    },
    describe: () => ({ label: 'Export MIDI' }),
    undoable: false,
});
