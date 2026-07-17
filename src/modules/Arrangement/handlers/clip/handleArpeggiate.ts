import { arpeggiate } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

type ArpPattern = Parameters<typeof arpeggiate>[1];
type ArpRate = Parameters<typeof arpeggiate>[2];
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
