import { createHandler } from '#/helpers/createHandler';
import { addCvOutput } from '#/modules/Synth';

// AudioEngine-local shape (AGENTS.md §95 — model isolation).
type CvOutputType = 'cv-pitch' | 'cv-velocity' | 'cv-modulation' | 'gate' | 'trigger' | 'clock';

export const handleAddCvOutput = createHandler<'addCvOutput'>({
    execute: (a) => {
        addCvOutput(a.payload.name, a.payload.channel, a.payload.type as CvOutputType);
    },
    describe: () => ({ label: 'Add CV/Gate Output' }),
    undoable: true,
});
