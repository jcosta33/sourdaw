import { addCvOutput } from '#/modules/CvGate/useCases';
import { createHandler } from '#/utils/createHandler';

// AudioEngine-local shape (AGENTS.md §95 — model isolation).
type CvOutputType = 'cv-pitch' | 'cv-velocity' | 'cv-modulation' | 'gate' | 'trigger' | 'clock';

export const handleAddCvOutput = createHandler<'addCvOutput'>({
    execute: (alpha) => {
        addCvOutput(alpha.payload.name, alpha.payload.channel, alpha.payload.type as CvOutputType);
    },
    describe: () => ({ label: 'Add CV/Gate Output' }),
    undoable: true,
});
