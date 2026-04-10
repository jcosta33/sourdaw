import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { arpeggiate, type ArpPattern, type ArpRate } from '#/modules/MIDI';
import type { ExtractAction } from '../types';

export const executeArpeggiate = inject({ arpeggiate })(
    ({ arpeggiate }) =>
        function executeArpeggiate(a: ExtractAction<AppAction, 'arpeggiate'>): void {
            arpeggiate(
                a.payload.clipId,
                (a.payload.pattern as ArpPattern) ?? 'up',
                (a.payload.rate as ArpRate) ?? 16,
                a.payload.octaves ?? 1,
                a.payload.gate ?? 80
            );
        }
);

export const handleArpeggiate = createHandler<'arpeggiate'>({
    execute: executeArpeggiate,
    describe: (a) => ({ label: `Arpeggiate (${a.payload.pattern ?? 'up'})` }),
    undoable: true,
});
