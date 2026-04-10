import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { stripSilence } from '../../useCases/stripSilence';
import type { ExtractAction } from '../types';

export const executeStripSilence = inject({ stripSilence })(
    ({ stripSilence }) =>
        function executeStripSilence(a: ExtractAction<AppAction, 'stripSilence'>): void {
            stripSilence(a.payload.clipId, a.payload.threshold, a.payload.minDuration);
        }
);

export const handleStripSilence = createHandler<'stripSilence'>({
    execute: executeStripSilence,
    describe: () => ({ label: 'Strip silence' }),
    undoable: true,
});
