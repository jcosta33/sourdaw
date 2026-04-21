import { exportMidiClip } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleExportMidi = createHandler<'exportMidi'>({
    execute: (alpha) => {
        exportMidiClip(alpha.payload.clipId);
    },
    describe: () => ({ label: 'Export MIDI' }),
    undoable: false,
});
