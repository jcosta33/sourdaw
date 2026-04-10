import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { toggleSoloSafe } from '#/modules/Arrangement/useCases/toggleTrackState/toggleSoloSafe';
import type { ExtractAction } from '../types';

const executeToggleSoloSafe = inject({ toggleSoloSafe })(
    ({ toggleSoloSafe }) =>
        function executeToggleSoloSafe(a: ExtractAction<AppAction, 'toggleSoloSafe'>): void {
            toggleSoloSafe(a.payload.trackId);
        }
);

export const handleToggleSoloSafe = createHandler<'toggleSoloSafe'>({
    execute: executeToggleSoloSafe,
    describe: () => ({ label: 'Toggle solo safe' }),
    undoable: true,
});
