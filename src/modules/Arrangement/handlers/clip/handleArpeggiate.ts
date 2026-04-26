import { arpeggiate, type ArpPattern, type ArpRate } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleArpeggiate = createHandler<'arpeggiate'>({
    execute: (alpha) => {
        arpeggiate(
            alpha.payload.clipId,
            (alpha.payload.pattern as ArpPattern) ?? 'up',
            (alpha.payload.rate as ArpRate) ?? 16,
            alpha.payload.octaves ?? 1,
            alpha.payload.gate ?? 80
        );
    },
    describe: (alpha) => ({ label: `Arpeggiate (${alpha.payload.pattern ?? 'up'})` }),
    undoable: true,
});
