import { createHandler } from '#/utils/createHandler';
import { arpeggiate, type ArpPattern, type ArpRate } from '#/modules/MIDI/useCases';

export const handleArpeggiate = createHandler<'arpeggiate'>({
    execute: (a) => {
        arpeggiate(
            a.payload.clipId,
            (a.payload.pattern as ArpPattern) ?? 'up',
            (a.payload.rate as ArpRate) ?? 16,
            a.payload.octaves ?? 1,
            a.payload.gate ?? 80
        );
    },
    describe: (a) => ({ label: `Arpeggiate (${a.payload.pattern ?? 'up'})` }),
    undoable: true,
});
