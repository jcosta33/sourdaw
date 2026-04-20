import { exportMidiClip } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleExportMidi = createHandler<'exportMidi'>({
    execute: (a) => {
        exportMidiClip(a.payload.clipId);
    },
    describe: () => ({ label: 'Export MIDI' }),
    undoable: false,
});
